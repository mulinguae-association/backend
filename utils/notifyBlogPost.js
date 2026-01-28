import User from "../db/models/User.js";

export async function notifyBlogPost(blogPost, senderSocketId = null) {
  const users = await User.find({ _id: { $ne: blogPost.postedBy } });
  const notifications = users.map((user) => ({
    user: user._id,
    type: "blog",
    message: `New blog post: ${blogPost.title}`,
    link: `/pages/blogs/${blogPost._id}`,
  }));

  let createdNotifications = [];
  if (notifications.length > 0) {
    const { default: Notification } =
      await import("../db/models/Notification.js");
    createdNotifications = await Notification.insertMany(notifications);
  }

  // Emit real-time notification only to online users
  try {
    const { io } = await import("../app.js");
    const { getSocketIdByUserId } = await import("./onlineUsers.js");
    createdNotifications.forEach((noti) => {
      const socketId = getSocketIdByUserId(noti.user.toString());
      if (socketId && socketId !== senderSocketId) {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
          s.emit("newBlogPost", {
            _id: noti._id,
            user: noti.user,
            type: "blog",
            message: noti.message,
            link: noti.link,
            isRead: false,
            createdAt: noti.createdAt,
          });
        }
      }
    });
  } catch (err) {
    console.error("Socket.IO emit error:", err);
  }
}
