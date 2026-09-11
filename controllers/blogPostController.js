import BlogPost from "../db/models/BlogPost.js";
import User from "../db/models/User.js";
import { isAdminRole } from "../utils/isAdminRole.js";

export async function createBlogPost(req, res) {
  try {
    const { title, subTitle, content } = req.body;
    const authorId = req.userId;
    const author = await User.findById(authorId)
    const blogPost = new BlogPost({ title, subTitle, content, postedBy: author });
    isAdminRole(req.role) ? blogPost.status = "accepted" : blogPost.status = "pending"
    await blogPost.save();

    return res.json({
      message: "Blog post submitted successfully",
      blogPost: blogPost.toObject(),
    });
  } catch (error) {
    console.error("Error submitting blog post:", error);
    return res.json({ error: "An error occurred" });
  }
}

export async function getPendingBlogPosts(req, res) {
  try {
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ error: "No permission." });
    }
    const pendingPosts = await BlogPost.find({ status: "pending" });
    res.status(200).json(pendingPosts.map((post) => post.toObject()));
  } catch (error) {
    console.error("Error retrieving blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export async function acceptBlogPost(req, res) {
  try {
    const { id } = req.params;
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ error: "No permission." });
    }
    await BlogPost.findByIdAndUpdate(id, { status: "accepted" });
    return res.status(200).json({ message: "Blog post accepted successfully" });
  } catch (error) {
    console.error("Error accepting blog post:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
}

export async function deleteBlogPost(req, res) {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const blogPost = await BlogPost.findById(id);
    if (blogPost.authorId == userId || isAdminRole(req.role)) {
      await BlogPost.findByIdAndDelete(id);
      return res
        .json({ message: "Blog post deleted successfully" });
    } else {
      return res
        .json({ error: "No permission to delete blog post" });
    }

  } catch (error) {
    return res.json({ error: "An error occurred" });
  }
}

export async function getAcceptedBlogPosts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const acceptedPosts = await BlogPost.find({ status: "accepted" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role"
      })
      .exec();
    res.status(200).json(acceptedPosts);
  } catch (error) {
    console.error("Error retrieving accepted blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export async function searchBlogPosts(req, res) {
  const searchQuery = req.query.q;
  try {
    const searchRegex = new RegExp(searchQuery, "i"); // Case-insensitive search
    // find users matching the query 
    const users = await User.find({
      name: { $regex: searchRegex }
    }).exec();

    const userIds = users.map(user => user._id);
    const searchResults = await BlogPost.find({
      status: "accepted",
      $or: [
        { title: { $regex: searchRegex } },
        { postedBy: { $in: userIds } },
      ],
    }).sort({ createdAt: -1 })
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role"
      })

    res.status(200).json(searchResults);
  } catch (error) {
    console.error("Error searching blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}