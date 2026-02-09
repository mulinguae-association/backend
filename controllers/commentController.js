// Import your modules here
import mongoose from "mongoose";
import BlogPost from "../db/models/BlogPost.js";
import Comment from "../db/models/Comment.js";
import User from "../db/models/User.js";

const userPouplate = {
  path: "postedBy",
  select: "_id name profileImage role",
};

// Define your functions
async function createComment(req, res) {
  try {
    const { content } = req.body;
    const authorId = req.user._id;
    const id = req.params.id; // blog id comes from route param
    // find author info
    const author = await User.findById(authorId);

    // Find the blog post with the provided ID
    const blogPost = await BlogPost.findById(id);

    if (!blogPost) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    const comment = new Comment({
      content,
      blogId: id,
      postedBy: author,
      parentComment: null,
      status: req.user.role === "admin" ? "accepted" : "pending",
    });

    await comment.save();

    // Increment parent comment count on BlogPost atomically
    await BlogPost.findByIdAndUpdate(id, { $inc: { commentsCount: 1 } });

    res.status(201).json({ message: "Comment added successfully", comment });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
async function updatedComment(req, res) {
  const { id } = req.params;
  const { content } = req.body;
  try {
    // Find the blog post with the provided ID
    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }
    if (
      comment.postedBy._id.toString() === req.user._id.toString() ||
      req.user.role === "admin"
    ) {
      // Update the comment content
      comment.content = content;
      comment.status = req.user.role === "admin" ? "accepted" : "pending";

      // Save the updated comment
      await comment.save();

      res.status(201).json({ message: "Comment updated successfully" });
    }
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
// Create a reply comment and push it into the parent comment's replies array
async function createReplyComment(req, res) {
  const { content, blogId, parentCommentId } = req.body;
  const authorId = req.user._id;
  try {
    const parentComment = await Comment.findById(parentCommentId);
    // find author info
    const author = await User.findById(authorId);
    if (!parentComment) {
      return res.status(404).json({ error: "Parent comment not found" });
    }

    const replyComment = new Comment({
      content,
      blogId,
      postedBy: author,
      parentComment: parentCommentId,
      status: req.user.role === "admin" ? "accepted" : "pending",
    });

    await replyComment.save();

    // Atomically push reply id into parentComment.replies and increment repliesCount
    await Comment.findByIdAndUpdate(parentCommentId, {
      $push: { replies: replyComment._id },
      $inc: { repliesCount: 1 },
    });

    // Atomically update lastReply on blog post
    await BlogPost.findByIdAndUpdate(blogId, {
      $set: { lastReply: replyComment._id },
    });

    return res
      .status(201)
      .json({ message: "Reply added successfully", comment: replyComment });
  } catch (error) {
    console.error("Error adding reply comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

async function getPendingComments(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No permission." });
    }
    const pendingComments = await Comment.find({ status: "pending" }).populate([
      {
        path: "replies",
        model: "Comment",
      },
      {
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role",
      },
    ]);
    res.status(200).json(pendingComments);
  } catch (error) {
    console.error("Error retrieving blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
async function getAcceptedComments(req, res) {
  const { blogId } = req.params;
  const { pageParam = 1, limit = 1 } = req.query;
  const skip = (pageParam - 1) * limit;

  try {
    // Fetch accepted parent comments with replies
    const acceptedComments = await Comment.find({
      blogId,
      parentComment: null, // Only parent comments
      status: "accepted",
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate(userPouplate);

    const totalComments = await Comment.aggregate([
      {
        $match: {
          blogId: new mongoose.Types.ObjectId(blogId),
          status: "accepted",
        },
      }, // Match accepted comments
      {
        $group: {
          _id: null, // Group everything
          totalCount: { $sum: 1 }, // Count each comment
        },
      },
    ]);

    // Safely extract total comment count
    const totalCommentCount =
      totalComments.length > 0 ? totalComments[0].totalCount : 0;
    // Return the accepted comments and the total comment count
    res
      .status(200)
      .json({ acceptedComments, totalComments: totalCommentCount });
  } catch (error) {
    console.error("Error retrieving accepted comments:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Controller to get remaining replies
async function getRemainingAcceptedReplies(req, res) {
  const { parentCommentIds } = req.query; // Get from query params, not route params
  const { pageParam = 1, limit = 3 } = req.query;
  const skip = (pageParam - 1) * limit;
  try {
    // Check if parentCommentIds is provided
    if (!parentCommentIds) {
      return res.status(400).json({ message: "Parent comment ID is required" });
    }

    const remainingReplies = await Comment.find({
      parentComment: parentCommentIds,
      status: "accepted",
    })
      .skip(skip)
      .limit(parseInt(limit))
      .populate(userPouplate);

    // Get the last (most recent) accepted reply
    const lastAcceptedReply = await Comment.findOne({
      parentComment: parentCommentIds,
      status: "accepted",
    })
      .sort({ _id: -1 })
      .populate(userPouplate);

    // Also return total accepted replies count for the parent comment
    const totalAcceptedReplies = await Comment.countDocuments({
      parentComment: parentCommentIds,
      status: "accepted",
    });

    res
      .status(200)
      .json({ remainingReplies, totalAcceptedReplies, lastAcceptedReply });
  } catch (err) {
    console.error("Error fetching replies:", err);
    res.status(500).json({ message: "Error fetching replies" });
  }
}

async function acceptComment(req, res) {
  try {
    const { id } = req.params;

    // Perform the logic to update the status of the blog post with the provided ID to "accepted"
    // For example:
    const comment = await Comment.findById(id);
    comment.status = "accepted";
    await comment.save();

    res.status(200).json({ message: "Blog post accepted successfully" });
  } catch (error) {
    console.error("Error accepting blog post:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

async function deleteComment(req, res) {
  const { commentId } = req.params;
  const authorId = req.user._id;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const isParentComment = comment.parentComment === null; // Check if this is a parent comment

    if (
      comment.postedBy._id.toString() === authorId.toString() ||
      req.user.role === "admin"
    ) {
      if (isParentComment) {
        // Delete all replies of this parent comment
        await Comment.deleteMany({ parentComment: commentId });
        // Decrement blog post parent comment count
        await BlogPost.findByIdAndUpdate(req.params.blogId, {
          $inc: { commentsCount: -1 },
        });
      } else {
        // If this is a reply, remove it from parent's replies array and decrement repliesCount
        await Comment.findByIdAndUpdate(comment.parentComment, {
          $pull: { replies: comment._id },
          $inc: { repliesCount: -1 },
        });
      }

      // Delete the comment
      await Comment.findByIdAndDelete(commentId);

      res.status(200).json({ message: "Comment deleted successfully" });
    } else {
      res.status(401).json({ error: "Unauthorized action" });
      console.log("Unauthorized action");
    }
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Export your functions
export {
  createComment,
  createReplyComment,
  updatedComment,
  deleteComment,
  getPendingComments,
  getAcceptedComments,
  getRemainingAcceptedReplies,
  acceptComment,
};
