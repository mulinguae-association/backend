import express from "express";
import authenticateUser from "../middleware/authMiddlewar.js";
import {
  getUsers,
  updateUser,
  deactivateUser,
  restoreUser,
} from "../controllers/userController.js";

const router = express.Router();

// Administrative account management. Every handler re-checks the role, so the
// guard here is only the first of two.
router.get("/", authenticateUser, getUsers);
router.put("/:id", authenticateUser, updateUser);
router.delete("/:id", authenticateUser, deactivateUser);
router.post("/:id/restore", authenticateUser, restoreUser);

export default router;
