import User from "../../../db/models/User.js";
import Ably from "ably";

const ably = new Ably.Rest(process.env.ABLY_API_KEY);

export async function notifyUsers({
  users,
  type,
  messageKey,
  messageParams,
  link,
  sourceType,
  sourceId,
  excludeUsers,
}) {
  // If users is a query filter, fetch users from DB
  let userList = Array.isArray(users) ? users : await User.find(users || {});
  // Optionally exclude one or more users
  if (excludeUsers) {
    const excludeIds = Array.isArray(excludeUsers)
      ? excludeUsers.map((u) => String(u._id || u))
      : [String(excludeUsers._id || excludeUsers)];
    userList = userList.filter(
      (user) => !excludeIds.includes(String(user._id)),
    );
  }
  const notifications = userList.map((user) => ({
    user: user._id,
    type,
    messageKey,
    messageParams,
    link,
    sourceType,
    sourceId,
  }));

  const { default: Notification } =
    await import("../../../db/models/Notification.js");

  const created = await Notification.insertMany(notifications);

  // 🔥 Publish ONLY a trigger event
  await Promise.all(
    created.map((noti) => {
      return ably.channels
        .get(`notifications:${noti.user}`)
        .publish("notification", {
          notificationId: noti._id,
        })
        .catch(console.error);
    }),
  );
}
