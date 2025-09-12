import express from "express";
import Multer from "multer";
import {
  getTeachersCard,
  createTeacherCard,
  deleteTeacherCard,
  updateTeacherCard,
} from "../controllers/teacherCardController.js";
import authenticateUser from "../middleware/authMiddlewar.js";

const router = express.Router();

// Multer configuration for handling image uploads
const storage = new Multer.memoryStorage();
const upload = Multer({ storage });

// API routes
router.post(
  "/teachersCard",
  upload.single("image"),
  authenticateUser,
  createTeacherCard
);
router.delete("/deleteTeacherCard/:id", authenticateUser, deleteTeacherCard);
router.patch(
  "/updateTeacher/:id",
  authenticateUser,
  upload.single("image"),
  updateTeacherCard
);
router.get("/teachers", getTeachersCard);
router.get("/teachers/:id", getTeachersCard);

export default router;
