import Notification from "../db/models/Notification.js";

// Get notifications for the logged-in user with pagination
export async function getUserNotifications(req, res) {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get notifications for the page
    const notificationsPromise = Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total and unread counts
    const totalPromise = Notification.countDocuments({ user: userId });
    const unreadPromise = Notification.countDocuments({
      user: userId,
      isRead: false,
    });

    const [notifications, total, unread] = await Promise.all([
      notificationsPromise,
      totalPromise,
      unreadPromise,
    ]);

    res.status(200).json({
      notifications,
      total,
      unread, // <--- This is the unread count for the badge
      page,
      limit,
      hasMore: skip + notifications.length < total,
    });
    console.log("Notifications fetched for user:", total);
    console.log("Unread notifications for user:", unread);
    console.log("Unread notifications for user:", notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Mark notification as read
export async function markNotificationRead(req, res) {
  try {
    const { id } = req.params;
    await Notification.findByIdAndUpdate(id, { isRead: true });
    res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Mark all notifications as read
export async function markAllNotificationsRead(req, res) {
  try {
    const userId = req.userId;
    await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true },
    );
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
