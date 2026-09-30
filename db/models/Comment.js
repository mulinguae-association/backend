import mongoose from "mongoose";

const commentSchema = new mongoose.Schema({
  content: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date },
  // Set when the comment becomes a tombstone. Null while it is live.
  deletedAt: { type: Date },
  deletedAuthorAvatar: { type: String },
  // "author" or "admin". Unvalidated, like status.
  deletedBy: { type: String },
  // Lifecycle vocabulary: "accepted" (live) and "deleted" (tombstone). An
  // edit does not change it. Left unvalidated on purpose - a new moderation
  // state should be a one-line change here, not a schema edit plus a sweep of
  status: { type: String, default: "accepted" },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  unlikes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  loves: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  blogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BlogPost",
  },
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Comment",
    default: null, // Default to null for top-level comments
  },
});

// Add indexes to speed up lookups and pagination
commentSchema.index({ blogId: 1, parentComment: 1, status: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1, status: 1 });

const Comment = mongoose.model("Comment", commentSchema);

export default Comment;
