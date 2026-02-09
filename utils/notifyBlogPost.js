import User from "../db/models/User.js";

export async function notifyBlogPost(blogPost, senderSocketId = null) {
  const users = await User.find({ _id: { $ne: blogPost.postedBy } });
  // Notifications for all users except author
  const notifications = users.map((user) => ({
    user: user._id,
    type: "blog",
    messageKey: "notifications.blogAdded",
    messageParams: {
      blogTitle: blogPost.title,
      author: blogPost.postedBy?.name || "Someone",
    },
    link: `/pages/blogs/${blogPost._id}`,
    sourceType: "blog",
    sourceId: blogPost._id,
  }));

  // Notification for the author (only if not admin)
  let createdNotifications = [];
  const isAuthorAdmin = ["admin", "superadmin"].includes(
    blogPost.postedBy?.role,
  );
  let notificationsToInsert = [...notifications];
  if (!isAuthorAdmin) {
    const authorNotification = {
      user: blogPost.postedBy._id || blogPost.postedBy,
      type: "blog",
      messageKey: "notifications.blogAccepted",
      messageParams: {
        blogTitle: blogPost.title,
      },
      link: `/pages/blogs/${blogPost._id}`,
      sourceType: "blog",
      sourceId: blogPost._id,
    };
    notificationsToInsert.push(authorNotification);
  }
  if (notificationsToInsert.length > 0) {
    const { default: Notification } =
      await import("../db/models/Notification.js");
    createdNotifications = await Notification.insertMany(notificationsToInsert);
  }

  // Emit real-time notification only to online users
  try {
    const { io } = await import("../app.js");
    const { getSocketIdByUserId } = await import("./onlineUsers.js");
    const { default: BlogPost } = await import("../db/models/BlogPost.js");
    // Cache for blog post details to avoid repeated DB queries
    const blogCache = new Map();
    for (const noti of createdNotifications) {
      let blogPostDetails;
      if (noti.sourceType === "blog" && noti.sourceId) {
        const cacheKey = noti.sourceId.toString();
        if (blogCache.has(cacheKey)) {
          blogPostDetails = blogCache.get(cacheKey);
        } else {
          blogPostDetails = await BlogPost.findById(noti.sourceId)
            .populate({
              path: "postedBy",
              select: "_id name profileImage role",
            })
            .lean();
          blogCache.set(cacheKey, blogPostDetails);
        }
      }
      const socketId = getSocketIdByUserId(noti.user.toString());
      if (socketId && socketId !== senderSocketId) {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
          s.emit("newBlogPost", {
            _id: noti._id,
            messageKey: noti.messageKey,
            messageParams: noti.messageParams,
            link: noti.link,
            sourceType: noti.sourceType,
            sourceId: blogPostDetails
              ? {
                  _id: blogPostDetails._id,
                  postedBy: blogPostDetails.postedBy,
                }
              : undefined,
            isRead: false,
            createdAt: noti.createdAt,
          });
        }
      }
    }
  } catch (err) {
    console.error("Socket.IO emit error:", err);
  }
}
