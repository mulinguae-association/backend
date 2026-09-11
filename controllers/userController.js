import User from "../db/models/User.js";

// List all users
export const listUsers = async (req, res) => {
  try {
    const users = await User.find(
      {},
      "_id name email role status deactivatedAt profileImage terms",
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

// Get user details
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(
      req.params.id,
      "_id name email role status deactivatedAt profileImage terms",
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

// Update user (admin can change name, email, role, status, terms)
export const updateUser = async (req, res) => {
  try {
    const { name, email, role, status, terms } = req.body;
    const userDoc = await User.findById(req.params.id);
    if (!userDoc) return res.status(404).json({ error: "User not found" });

    // Only update fields if changed
    let updateFields = {};
    if (name && name !== userDoc.name) updateFields.name = name;
    if (email && email !== userDoc.email) updateFields.email = email;
    if (role && role !== userDoc.role) updateFields.role = role;
    if (typeof terms !== "undefined" && terms !== userDoc.terms)
      updateFields.terms = terms;
    if (status && status !== userDoc.status) {
      updateFields.status = status;
      if (status === "deactivated") {
        updateFields.deactivatedAt = new Date();
      } else if (status === "active") {
        updateFields.deactivatedAt = null;
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.json(userDoc); // nothing to update
    }

    try {
      const user = await User.findByIdAndUpdate(req.params.id, updateFields, {
        new: true,
        runValidators: true,
        fields: "_id name email role status deactivatedAt profileImage terms",
      });
      res.json(user);
    } catch (err) {
      if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
        return res.status(400).json({
          error: "Email already exists. Please use a different email address.",
        });
      }
      throw err;
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to update user" });
  }
};

// Deactivate user (soft delete: set status to 'deactivated' and set deactivatedAt)
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: "deactivated", deactivatedAt: new Date() },
      {
        new: true,
        runValidators: true,
        fields: "_id name email role status deactivatedAt profileImage terms",
      },
    );
    res.json({ message: "User deactivated", user });
  } catch (err) {
    res.status(500).json({ error: "Failed to deactivate user" });
  }
};

// Restore user (set status to 'active' and clear deactivatedAt)
export const restoreUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: "active", deactivatedAt: null },
      {
        new: true,
        runValidators: true,
        fields: "_id name email role status deactivatedAt profileImage terms",
      },
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User restored", user });
  } catch (err) {
    res.status(500).json({ error: "Failed to restore user" });
  }
};

// (Optional) Create user
export const createUser = async (req, res) => {
  try {
    const { name, email, password, role, terms } = req.body;
    const user = new User({ name, email, password, role, terms });
    await user.save();
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: "Failed to create user" });
  }
};
