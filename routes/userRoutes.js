import express from "express";
import authenticateUser from "../middleware/authMiddlewar.js";
import authorizeRoles from "../middleware/roleMiddleware.js";
import {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  createUser,
  restoreUser,
} from "../controllers/userController.js";
import protectSelf from "../middleware/protectSelf.js";
import protectHigherRole from "../middleware/roleHierarchy.js";
import User from "../db/models/User.js";

const router = express.Router();

router.use(authenticateUser);
router.use(authorizeRoles("admin", "superadmin"));

// List all users
router.get("/", listUsers);
// Get user details
router.get("/:id", getUser);
// Update user
router.put(
  "/:id",
  protectSelf,
  protectHigherRole((req) => User.findById(req.params.id)),
  updateUser,
);
// Delete (deactivate) user
router.delete(
  "/:id",
  protectSelf,
  protectHigherRole((req) => User.findById(req.params.id)),
  deleteUser,
);

// (Optional) Create user
router.post("/", createUser);

// Restore (reactivate) user
router.post(
  "/:id/restore",
  protectHigherRole((req) => User.findById(req.params.id)),
  restoreUser,
);

export default router;
