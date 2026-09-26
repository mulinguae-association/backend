import mongoose, { Schema } from "mongoose";

// The one place a blog category is defined. Creation validation, the list
// filter and any future edit endpoint all read this list, so the allowed set
// cannot drift between them.
export const BLOG_CATEGORIES = [
  "grammar",
  "vocabulary",
  "pronunciation",
  "tips",
  "culture",
  "teaching",
  "tools",
  "journeys",
  "education",
  "general",
];

export const DEFAULT_BLOG_CATEGORY = "general";

const blogPostSchema = new Schema({
  title: { type: String, required: true },
  subTitle: { type: String, required: false },
  content: { type: String, required: true },
  category: { type: String, default: DEFAULT_BLOG_CATEGORY },
  status: { type: String, default: "accepted" },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
  unlikes: [{ type: Schema.Types.ObjectId, ref: "User" }],
  loves: [{ type: Schema.Types.ObjectId, ref: "User" }],
  avatar: { type: String, required: false },
  postedBy: { type: Schema.Types.ObjectId, ref: "User" },
  // Denormalized count of top-level (parent) comments for fast reads
  commentsCount: { type: Number, default: 0 },
  // Optional last reply reference
  lastReply: { type: Schema.Types.ObjectId, ref: "Comment", required: false },
});

const BlogPost = mongoose.model("BlogPost", blogPostSchema);

export default BlogPost;
