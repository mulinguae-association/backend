import mongoose from "mongoose";
import User from "../db/models/User.js";
import { problem } from "../utils/problem.js";
import { isAdminRole } from "../utils/isAdminRole.js";

const ADMIN_STATUS = 403;

/** Every route here is admin-only, so the check lives in one place. */
const requireAdmin = (req, res) => {
  if (isAdminRole(req.role)) return true;
  problem(res, {
    req,
    status: ADMIN_STATUS,
    code: "UNAUTHORIZED",
    title: "Administrator access required",
  });
  return false;
};

// Roles are the admission ladder: an admin can run the table and manage ordinary
// accounts, but only a superadmin can reassign roles or disable another
// administrator. Without that split an admin could promote themselves by editing
// their own row, and a compromised admin could put every other admin offline.
const isSuperadmin = (role) => role === "superadmin";

const isAdminTarget = (role) => role && role !== "user";

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Accounts created before the `status` field existed have no value stored, and
 * Mongoose only applies a default on save, not on read. Treat a missing value as
 * active so the admin table never has to know that.
 */
const withStatus = (user) => ({
  ...user,
  status: user.status || "active",
  deactivatedAt: user.deactivatedAt ?? null,
});

/**
 * List accounts for the admin table, filtered and paginated.
 *
 * The search term is escaped so a name like "a(b" is matched literally instead
 * of being read as a pattern.
 */
export async function getUsers(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const { search, role, status } = req.query;

    const filter = {};
    if (typeof search === "string" && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ name: rx }, { email: rx }];
    }
    if (role) filter.role = role;
    if (status) filter.status = status;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("_id name email role status deactivatedAt createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      users: users.map(withStatus),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("Error listing users:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

export async function updateUser(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return problem(res, {
        req,
        status: 400,
        code: "USER_NOT_FOUND",
        title: "User not found",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return problem(res, {
        req,
        status: 404,
        code: "USER_NOT_FOUND",
        title: "User not found",
      });
    }

    const { name, email, role } = req.body || {};
    if (typeof name === "string" && name.trim()) user.name = name.trim();
    if (typeof email === "string" && email.trim())
      user.email = email.trim().toLowerCase();
    if (role) {
      if (!["admin", "superadmin", "user"].includes(role)) {
        return problem(res, {
          req,
          status: 400,
          code: "ROLE_INVALID",
          title: "Unknown role",
        });
      }
      // Reassigning roles is the step that can hand out admin rights, so it is
      // superadmin-only. An admin editing a name or email is fine; an admin
      // granting themselves a role is not.
      if (!isSuperadmin(req.role)) {
        return problem(res, {
          req,
          status: ADMIN_STATUS,
          code: "ROLE_CHANGE_FORBIDDEN",
          title: "Only a superadmin can change roles",
        });
      }
      // The last superadmin must not be able to demote themselves out of the
      // role, which would leave the account unable to administer anything.
      if (user.role === "superadmin" && role !== "superadmin") {
        const others = await User.countDocuments({
          role: "superadmin",
          _id: { $ne: user._id },
        });
        if (others === 0) {
          return problem(res, {
            req,
            status: ADMIN_STATUS,
            code: "LAST_SUPERADMIN",
            title: "The last superadmin cannot be demoted",
          });
        }
      }
      user.role = role;
    }

    await user.save();
    res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    // A duplicate email surfaces as a Mongo duplicate-key error.
    if (error?.code === 11000) {
      return problem(res, {
        req,
        status: 409,
        code: "EMAIL_TAKEN",
        title: "That email is already used",
      });
    }
    console.error("Error updating user:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

/**
 * Deactivate rather than delete: the account's posts and comments are its
 * history, and a hard delete would leave both without an author.
 */
export async function deactivateUser(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { id } = req.params;
    if (String(req.userId) === String(id)) {
      return problem(res, {
        req,
        status: ADMIN_STATUS,
        code: "CANNOT_DEACTIVATE_SELF",
        title: "You cannot deactivate your own account",
      });
    }

    // The target's role decides who may take it offline: a plain admin must not
    // be able to disable another admin or a superadmin, or one compromised
    // account would lock the whole admission team out.
    const target = await User.findById(id).select("role");
    if (!target) {
      return problem(res, {
        req,
        status: 404,
        code: "USER_NOT_FOUND",
        title: "User not found",
      });
    }
    if (isAdminTarget(target.role) && !isSuperadmin(req.role)) {
      return problem(res, {
        req,
        status: ADMIN_STATUS,
        code: "ADMIN_ACTION_FORBIDDEN",
        title: "Only a superadmin can deactivate an administrator",
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { status: "deactivated", deactivatedAt: new Date() } },
      { new: true },
    ).select("_id status deactivatedAt");
    res.status(200).json({ user });
  } catch (error) {
    console.error("Error deactivating user:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

export async function restoreUser(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const target = await User.findById(req.params.id).select("role");
    if (!target) {
      return problem(res, {
        req,
        status: 404,
        code: "USER_NOT_FOUND",
        title: "User not found",
      });
    }
    if (isAdminTarget(target.role) && !isSuperadmin(req.role)) {
      return problem(res, {
        req,
        status: ADMIN_STATUS,
        code: "ADMIN_ACTION_FORBIDDEN",
        title: "Only a superadmin can restore an administrator",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "active", deactivatedAt: null } },
      { new: true },
    ).select("_id status deactivatedAt");
    res.status(200).json({ user });
  } catch (error) {
    console.error("Error restoring user:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}
