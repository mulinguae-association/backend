import mongoose, { Schema } from "mongoose";

const blogPostSchema = new Schema({
  title: { type: String, required: true },
  subTitle: { type: String, required: false },
  content: { type: String, required: true },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
  unlikes: [{ type: Schema.Types.ObjectId, ref: "User" }],
  loves: [{ type: Schema.Types.ObjectId, ref: "User" }],
  avatar: { type: String, required: false },
  postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
});


const BlogPost = mongoose.model("BlogPost", blogPostSchema);

export default BlogPost;
