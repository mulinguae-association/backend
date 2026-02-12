import User from "../../db/models/User.js";
import Ably from "ably";

const ably = new Ably.Rest(process.env.ABLY_API_KEY);

export async function sendAdminNotification(notificationData) {
  // Find all admins and superadmins
  const admins = await User.find({ role: { $in: ["admin", "superadmin"] } });

  if (!admins.length) return;

  // Prepare notifications for all admins
  const notifications = admins.map((admin) => ({
    ...notificationData,
    user: admin._id,
  }));

  // Save notifications to DB
  const { default: Notification } =
    await import("../../db/models/Notification.js");
  const created = await Notification.insertMany(notifications);

  // Publish real-time notification to each admin via Ably
  await Promise.all(
    created.map((noti) =>
      ably.channels
        .get(`notifications:${noti.user}`)
        .publish("notification", {
          notificationId: noti._id,
          ...notificationData, // Optionally include more info
        })
        .catch(console.error),
    ),
  );
}
