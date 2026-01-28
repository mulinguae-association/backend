import BlogPost from "../db/models/BlogPost.js";
import User from "../db/models/User.js";

export async function createBlogPost(req, res) {
  try {
    const { title, subTitle, content, senderSocketId } = req.body;
    const authorId = req.userId;
    const author = await User.findById(authorId);
    const blogPost = new BlogPost({
      title,
      subTitle,
      content,
      postedBy: author,
    });
    req.role === "admin"
      ? (blogPost.status = "accepted")
      : (blogPost.status = "pending");
    await blogPost.save();

    // Only send notifications and emit real-time event if post is accepted
    if (blogPost.status === "accepted") {
      const { notifyBlogPost } = await import("../utils/notifyBlogPost.js");
      await notifyBlogPost(blogPost, senderSocketId);
    }

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
    if (req.role !== "admin") {
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

    if (req.role !== "admin") {
      return res.status(403).json({ error: "No permission." });
    }

    // Get the post before update
    const oldPost = await BlogPost.findById(id);
    if (oldPost.status === "accepted") {
      return res.status(400).json({ error: "Blog post already accepted" });
    }

    const blogPost = await BlogPost.findByIdAndUpdate(
      id,
      {
        status: "accepted",
      },
      { new: true },
    );
    const { notifyBlogPost } = await import("../utils/notifyBlogPost.js");
    await notifyBlogPost(blogPost, null);
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
    if (blogPost.authorId == userId || req.role === "admin") {
      await BlogPost.findByIdAndDelete(id);
      return res.json({ message: "Blog post deleted successfully" });
    } else {
      return res.json({ error: "No permission to delete blog post" });
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
        select: "_id name profileImage role",
      })
      .exec();
    res.status(200).json(acceptedPosts);
  } catch (error) {
    console.error("Error retrieving accepted blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export async function getBlogPostById(req, res) {
  try {
    const { id } = req.params;
    const blogPost = await BlogPost.findById(id, {
      status: "accepted",
    }).populate({
      path: "postedBy",
      model: "User",
      select: "_id name profileImage role",
    });
    if (!blogPost) {
      return res.status(404).json({ error: "Blog post not found" });
    }
    res.status(200).json(blogPost);
  } catch (error) {
    console.error("Error fetching blog post:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export async function searchBlogPosts(req, res) {
  const searchQuery = req.query.q;
  try {
    const searchRegex = new RegExp(searchQuery, "i"); // Case-insensitive search
    // find users matching the query
    const users = await User.find({
      name: { $regex: searchRegex },
    }).exec();

    const userIds = users.map((user) => user._id);
    const searchResults = await BlogPost.find({
      status: "accepted",
      $or: [{ title: { $regex: searchRegex } }, { postedBy: { $in: userIds } }],
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role",
      });

    res.status(200).json(searchResults);
  } catch (error) {
    console.error("Error searching blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
