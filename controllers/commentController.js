// Import your modules here
import mongoose from "mongoose";
import BlogPost from "../db/models/BlogPost.js";
import Comment from "../db/models/Comment.js";
import User from "../db/models/User.js";

// Define your functions
async function createComment(req, res) {
  try {
    const { content, id } = req.body;
    const authorId = req.userId;
    const authorName = req.userName;
    // find author info
    const author = await User.findById(authorId)

    // Find the blog post with the provided ID
    const blogPost = await BlogPost.findById(id);

    if (!blogPost) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    const comment = new Comment({
      content,
      blogId: id,
      authorId,
      authorName,
      postedBy: author,
      status: req.role === "admin" ? "accepted" : "pending"
    });

    await comment.save();

    res.status(201).json({
      message: "Comment added successfully",
      comment: comment,
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
async function updatedComment(req, res) {
  const { id } = req.params
  const { content } = req.body;
  try {
    // Find the blog post with the provided ID
    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({ error: "Comment not found" })
    }
    if (comment.postedBy._id.toString() === req.userId.toString() || req.role === "admin") {
      // Update the comment content
      comment.content = content;
      comment.status = req.role === "admin" ? "accepted" : "pending";

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
  const authorId = req.userId;
  try {
    const parentComment = await Comment.findById(parentCommentId);
    // find author info
    const author = await User.findById(authorId)
    if (!parentComment) {
      return res.status(404).json({ error: "Parent comment not found" });
    }

    const replyComment = new Comment({
      content,
      blogId,
      postedBy: author,
      parentComment: parentCommentId,
      status: req.role === "admin" ? "accepted" : "pending"
    });

    await replyComment.save();

    parentComment.repliesCount += 1
    // parentComment.lastReply = replyComment._id;
    // add last reply to the blog post
    await parentComment.save();

    const blogPost = await BlogPost.findById(blogId);
    if (blogPost) {
      blogPost.lastReply = replyComment._id;
      await blogPost.save()
    }

    return res.status(201).json({
      message: "Reply added successfully",
      comment: replyComment,
    });
  } catch (error) {
    console.error("Error adding reply comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

async function getPendingComments(req, res) {
  try {
    if (req.role !== "admin") {
      return res.status(403).json({ error: "No permission." });
    }
    const pendingComments = await Comment.find({ status: "pending" }).populate({
      path: 'replies',
      model: 'Comment',
    });
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
      status: "accepted"
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role"
      });

    const totalComments = await Comment.aggregate([
      { $match: { blogId: new mongoose.Types.ObjectId(blogId), status: "accepted" } }, // Match accepted comments
      {
        $group: {
          _id: null, // Group everything
          totalCount: { $sum: 1 } // Count each comment
        }
      }
    ]);

    // Safely extract total comment count
    const totalCommentCount = totalComments.length > 0 ? totalComments[0].totalCount : 0;
    // let totalCommentCount = await Comment.countDocuments({ status: "accepted", blogId })
    // Return the accepted comments and the total comment count
    res.status(200).json({ acceptedComments, totalComments: totalCommentCount });
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

    const remainingReplies = await Comment.find({ parentComment: parentCommentIds, status: 'accepted' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "postedBy",
        model: "User", // Fixed typo: 'modal' -> 'model'
        select: "_id name profileImage role"
      });

    // Also return total accepted replies count for the parent comment
    const totalAcceptedReplies = await Comment.countDocuments({
      parentComment: parentCommentIds,
      status: "accepted",
    });

    res.status(200).json({ remainingReplies, totalAcceptedReplies });
  } catch (err) {
    console.error("Error fetching replies:", err);
    res.status(500).json({ message: "Error fetching replies" });
  }
};

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
  const authorId = req.userId;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const isParentComment = comment.parentComment === null; // Check if this is a parent comment

    if (comment.postedBy._id.toString() === authorId.toString() || req.role === "admin") {
      if (isParentComment) {
        await Comment.deleteMany({ parentComment: commentId })
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
  acceptComment
};
