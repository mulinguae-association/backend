import mongoose from "mongoose";

const commentSchema = new mongoose.Schema({
  content: String,
  createdAt: { type: Date, default: Date.now },
  status: { type: String, default: "pending" },
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
  replies: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
    },
  ],
  repliesCount: { type: Number, default: 0 },
});

// Add indexes to speed up lookups and pagination
commentSchema.index({ blogId: 1, parentComment: 1, status: 1, createdAt: -1 });

const Comment = mongoose.model("Comment", commentSchema);

export default Comment;
