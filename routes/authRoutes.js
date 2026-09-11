import express from "express";
import {
  getProfile,
  updateProfile,
  login,
  logout,
  register,
  refresh,
  forgotPassword,
  ResetPassword,
} from "../controllers/authController.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import Multer from "multer";

const router = express.Router();

// Multer configuration for handling image uploads
const storage = new Multer.memoryStorage();
const upload = Multer({ storage });

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/profile", getProfile);
// forgot password
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:id/:token", ResetPassword);
// update user info
router.put(
  "/user/update",
  upload.single("profileImage"),
  authenticateUser,
  updateProfile,
);

export default router;
