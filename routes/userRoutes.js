import express from "express";
import authenticateUser from "../middleware/authMiddlewar.js";
import {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  createUser,
  restoreUser,
} from "../controllers/userController.js";

const router = express.Router();

// Admin-only middleware
function isAdmin(req, res, next) {
  if (req.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// List all users
router.get("/", authenticateUser, isAdmin, listUsers);
// Get user details
router.get("/:id", authenticateUser, isAdmin, getUser);
// Update user
router.put("/:id", authenticateUser, isAdmin, updateUser);
// Delete (deactivate) user
router.delete("/:id", authenticateUser, isAdmin, deleteUser);

// (Optional) Create user
router.post("/", authenticateUser, isAdmin, createUser);

// Restore (reactivate) user
router.post("/:id/restore", authenticateUser, isAdmin, restoreUser);

export default router;
