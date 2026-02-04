import Notification from "../db/models/Notification.js";

// Get notifications for the logged-in user with pagination
export async function getUserNotifications(req, res) {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const filter = req.query.filter || "all";

    // Build filter query
    let notificationQuery = { user: userId };
    if (filter === "read") notificationQuery.isRead = true;
    if (filter === "unread") notificationQuery.isRead = false;

    // Get notifications for the page
    const notificationsPromise = Notification.find(notificationQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        {
          path: "sourceId",
          model: "BlogPost",
          select: "_id postedBy",
          populate: {
            path: "postedBy",
            model: "User",
            select: "_id name profileImage role",
          },
        },
      ]);

    // Get total and unread counts (always for all notifications)
    const totalPromise = Notification.countDocuments({ user: userId });
    const unreadPromise = Notification.countDocuments({
      user: userId,
      isRead: false,
    });
    // Get count for current filter
    const filterCountPromise = Notification.countDocuments(notificationQuery);

    const [notifications, total, unread, filterCount] = await Promise.all([
      notificationsPromise,
      totalPromise,
      unreadPromise,
      filterCountPromise,
    ]);

    res.status(200).json({
      notifications,
      total,
      unread, // <--- This is the unread count for the badge
      page,
      limit,
      filterCount,
      hasMore:
        skip + notifications.length < filterCount && notifications.length > 0,
    });
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

// Delete multiple notifications by IDs for the authenticated user
export async function deleteNotifications(req, res) {
  try {
    const userId = req.userId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No notification IDs provided" });
    }
    // Only delete notifications belonging to the user
    const result = await Notification.deleteMany({
      _id: { $in: ids },
      user: userId,
    });
    res
      .status(200)
      .json({ message: `Deleted ${result.deletedCount} notifications.` });
  } catch (error) {
    console.error("Error deleting notifications:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
