import BlogPost from "../db/models/BlogPost.js";
import User from "../db/models/User.js";

const userPouplate = {
  path: "postedBy",
  select: "_id name profileImage role",
};

// Merged create and edit blog post controller
export async function createOrEditBlogPost(req, res) {
  try {
    const { id, title, subTitle, content, senderSocketId } = req.body;
    const userId = req.user._id;
    const isEdit = !!id;

    // ---- Validation ----
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({
        error: "Title and content are required.",
      });
    }

    let blogPost;

    // ---- Edit flow ----
    if (isEdit) {
      blogPost = await BlogPost.findById(id);

      if (!blogPost) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      const isOwner = blogPost.postedBy.toString() === userId.toString();
      const isAdmin = ["admin", "superadmin"].includes(req.user.role);

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          error: "No permission to edit blog post",
        });
      }

      blogPost.title = title;
      blogPost.subTitle = subTitle;
      blogPost.content = content;

      // Non-admin edits go back to pending
      if (!isAdmin) {
        blogPost.status = "pending";
      }

      await blogPost.save();
    }

    // ---- Create flow ----
    if (!isEdit) {
      blogPost = await BlogPost.create({
        title,
        subTitle,
        content,
        postedBy: userId,
        status: ["admin", "superadmin"].includes(req.user.role)
          ? "accepted"
          : "pending",
      });
    }

    // ---- Populate once ----
    const populatedBlogPost = await BlogPost.findById(blogPost._id)
      .populate(userPouplate)
      .lean();

    // ---- Notifications only if accepted ----
    if (populatedBlogPost.status === "accepted") {
      const { notifyBlogPost } = await import("../utils/notifyBlogPost.js");
      await notifyBlogPost(populatedBlogPost, senderSocketId ?? null);
    }

    return res.status(isEdit ? 200 : 201).json({
      message: isEdit
        ? "Blog post updated successfully"
        : "Blog post submitted successfully",
      blogPost: populatedBlogPost,
    });
  } catch (error) {
    console.error("Error creating/editing blog post:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}

export async function getPendingBlogPosts(req, res) {
  try {
    if (!["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({ error: "No permission." });
    }
    const pendingPosts = await BlogPost.find({ status: "pending" })
      .sort({
        createdAt: -1,
      })
      .populate(userPouplate)
      .lean();

    res.status(200).json(pendingPosts);
  } catch (error) {
    console.error("Error retrieving blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export async function acceptBlogPost(req, res) {
  try {
    const { id } = req.params;

    if (!["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({ error: "No permission." });
    }

    const blogPost = await BlogPost.findByIdAndUpdate(
      { _id: id, status: { $ne: "accepted" } },
      {
        status: "accepted",
      },
      { new: true },
    ).populate(userPouplate);

    if (!blogPost) {
      return res
        .status(404)
        .json({ error: "Blog post not found or already accepted" });
    }

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
    const userId = req.user._id;

    const blogPost = await BlogPost.findById(id);
    if (!blogPost) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    // Normalize postedBy whether populated or ObjectId
    const ownerId =
      blogPost.postedBy && blogPost.postedBy._id
        ? blogPost.postedBy._id.toString()
        : (blogPost.postedBy || "").toString();

    const isOwner = ownerId === userId.toString();
    const isAdmin = ["admin", "superadmin"].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "No permission to delete blog post" });
    }

    await BlogPost.findByIdAndDelete(id);

    // Remove any related notifications
    const { default: Notification } =
      await import("../db/models/Notification.js");
    await Notification.deleteMany({ sourceType: "blog", sourceId: id });

    return res.status(200).json({
      message: "Blog post and related notifications deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting blog post:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
}

export async function getAcceptedBlogPosts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const userId = req.query.userId;
    const filter = { status: "accepted" };
    if (userId) filter.postedBy = userId;

    const acceptedPosts = await BlogPost.find(filter)

      .limit(limit)
      .populate(userPouplate)
      .sort({ createdAt: -1 });
    res.status(200).json(acceptedPosts);
  } catch (error) {
    console.error("Error retrieving accepted blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export async function getBlogPostById(req, res) {
  try {
    const { id } = req.params;
    const blogPost = await BlogPost.findOne({ _id: id, status: "accepted" })
      .populate(userPouplate)
      .lean();

    if (!blogPost) {
      return res.status(404).json({ error: "Blog post not found" });
    }
    res.status(200).json(blogPost);
  } catch (error) {
    console.error("Error fetching blog post:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Handler to fetch current user's blog posts
export async function getMyBlogPosts(req, res) {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit) || 5;

    const myPosts = await BlogPost.find({ postedBy: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate(userPouplate)
      .lean();
    return res.status(200).json(myPosts);
  } catch (error) {
    console.error("Error fetching user's blog posts:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
}

export async function searchBlogPosts(req, res) {
  const searchQuery = req.query.q;
  try {
    const searchRegex = new RegExp(searchQuery, "i"); // Case-insensitive search
    // find users matching the query
    const users = await User.find(
      {
        name: { $regex: searchRegex },
      },
      { _id: 1 },
    ).lean();

    const userIds = users.map((user) => user._id);
    const searchResults = await BlogPost.find({
      status: "accepted",
      $or: [{ title: { $regex: searchRegex } }, { postedBy: { $in: userIds } }],
    })
      .sort({ createdAt: -1 })
      .populate(userPouplate)
      .lean();
    res.status(200).json(searchResults);
  } catch (error) {
    console.error("Error searching blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
