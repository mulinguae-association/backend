import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, default: "blog" },
  messageKey: { type: String },
  messageParams: { type: Object },
  link: String,
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  sourceType: { type: String }, // e.g., 'blog', 'comment', etc.
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BlogPost",
  },
});

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
