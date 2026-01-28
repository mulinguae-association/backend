import express from "express";
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notificationController.js";
import authenticateUser from "../middleware/authMiddlewar.js";

const router = express.Router();

// Get notifications for logged-in user
router.get("/", authenticateUser, getUserNotifications);
// Mark notification as read
router.patch("/:id/read", authenticateUser, markNotificationRead);
// Mark all notifications as read
router.patch("/read-all", authenticateUser, markAllNotificationsRead);

export default router;
