import express from "express";
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotifications,
} from "../controllers/notificationController.js";
import authenticateUser from "../middleware/authMiddlewar.js";

const router = express.Router();

// Get notifications for logged-in user
router.get("/", authenticateUser, getUserNotifications);
// Mark notification as read
router.patch("/:id/read", authenticateUser, markNotificationRead);
// Mark all notifications as read
router.patch("/read-all", authenticateUser, markAllNotificationsRead);
// Delete multiple notifications by IDs
router.delete("/bulk-delete", authenticateUser, deleteNotifications);

export default router;
