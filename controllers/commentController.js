// Import your modules here
import mongoose from "mongoose";
import BlogPost from "../db/models/BlogPost.js";
import Comment from "../db/models/Comment.js";
import User from "../db/models/User.js";
import { isAdminRole } from "../utils/isAdminRole.js";

// Define your functions
async function createComment(req, res) {
  try {
    const { content } = req.body;
    const authorId = req.userId;
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
      status: isAdminRole(req.role) ? "accepted" : "pending",
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
      comment.postedBy._id.toString() === req.userId.toString() ||
      isAdminRole(req.role)
    ) {
      // Update the comment content
      comment.content = content;
      comment.status = isAdminRole(req.role) ? "accepted" : "pending";

      // Save the updated comment
      await comment.save();

      res.status(201).json({ message: "Comment updated successfully" });
    }
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
// Create a reply comment referenced by the parent via the flat parentComment field
async function createReplyComment(req, res) {
  const { content, blogId, parentCommentId } = req.body;
  const authorId = req.userId;
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
      status: isAdminRole(req.role) ? "accepted" : "pending",
    });

    await replyComment.save();

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
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ error: "No permission." });
    }
    const pendingComments = await Comment.find({ status: "pending" });
    res.status(200).json(pendingComments);
  } catch (error) {
    console.error("Error retrieving blog posts:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
async function getAcceptedComments(req, res) {
  const { blogId } = req.params;
  const { pageParam = 1, limit = 10 } = req.query;
  const pageNum = parseInt(pageParam) || 1;
  const limitNum = parseInt(limit) || 10;

  const populated = {
    path: "postedBy",
    model: "User",
    select: "_id name profileImage role",
  };

  // Attach the accepted reply count to every comment so parents can show how
  // many replies they have without loading them.
  async function attachReplyCounts(comments) {
    const ids = comments.map((comment) => comment._id).filter(Boolean);
    const rows = ids.length
      ? await Comment.aggregate([
          {
            $match: {
              parentComment: { $in: ids },
              status: "accepted",
            },
          },
          {
            $group: {
              _id: "$parentComment",
              count: { $sum: 1 },
            },
          },
        ])
      : [];
    const countMap = new Map(rows.map((row) => [String(row._id), row.count]));
    comments.forEach((comment) => {
      comment.repliesCount = countMap.get(String(comment._id)) || 0;
    });
    return comments;
  }

  try {
    // Pin the newest accepted parent comment and its newest reply onto page 1
    // so the blog feed can always preview them without loading later pages.
    const newestParent = await Comment.findOne({
      blogId,
      status: "accepted",
      parentComment: null,
    })
      .sort({ createdAt: -1 })
      .populate(populated)
      .lean();

    const newestReply = newestParent
      ? await Comment.findOne({
          blogId,
          status: "accepted",
          parentComment: newestParent._id,
        })
          .sort({ createdAt: -1 })
          .populate(populated)
          .lean()
      : null;

    const pinned = [newestParent, newestReply].filter(Boolean);
    const pinnedIds = pinned.map((comment) => comment._id);
    // How many of the remaining comments page 1 consumes after the pinned ones
    const restPerPage = Math.max(0, limitNum - pinned.length);
    // Remaining comments consumed by the pages before this one
    const restConsumed =
      pageNum === 1 ? 0 : restPerPage + (pageNum - 2) * limitNum;

    // Only top-level comments paginate on the blog query; replies are fetched
    // lazily per parent via the "show replies" button.
    const rest = await Comment.find(
      pinnedIds.length > 0
        ? {
            blogId,
            status: "accepted",
            parentComment: null,
            _id: { $nin: pinnedIds },
          }
        : { blogId, status: "accepted", parentComment: null },
    )
      .sort({ createdAt: -1 })
      .skip(Math.max(0, restConsumed))
      .limit(pageNum === 1 ? restPerPage : limitNum)
      .populate(populated)
      .lean();

    const acceptedComments = pageNum === 1 ? pinned.concat(rest) : rest;
    await attachReplyCounts(acceptedComments);

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

// Fetch accepted replies of a parent comment (older than `before` when given),
// used by the "show more replies" button of a thread.
async function getCommentReplies(req, res) {
  const { parentCommentId } = req.params;
  const { limit = 5, before } = req.query;
  try {
    const filter = {
      parentComment: parentCommentId,
      status: "accepted",
    };
    if (before) {
      const beforeDoc = await Comment.findById(before).select("createdAt");
      if (beforeDoc) filter.createdAt = { $lt: beforeDoc.createdAt };
    }

    const replies = await Comment.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) || 5)
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role",
      })
      .lean();

    // Attach each reply's own reply count so nested threads can show their own
    // "show replies (N)" button recursively.
    const ids = replies.map((reply) => reply._id).filter(Boolean);
    const countRows = ids.length
      ? await Comment.aggregate([
          {
            $match: {
              parentComment: { $in: ids },
              status: "accepted",
            },
          },
          {
            $group: {
              _id: "$parentComment",
              count: { $sum: 1 },
            },
          },
        ])
      : [];
    const countMap = new Map(
      countRows.map((row) => [String(row._id), row.count]),
    );
    replies.forEach((reply) => {
      reply.repliesCount = countMap.get(String(reply._id)) || 0;
    });

    res.status(200).json({ replies });
  } catch (error) {
    console.error("Error retrieving comment replies:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}

// Accept a comment (admin moderation)
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

    if (
      comment.postedBy._id.toString() === authorId.toString() ||
      isAdminRole(req.role)
    ) {
      if (isParentComment) {
        // Delete all replies of this parent comment
        await Comment.deleteMany({ parentComment: commentId });
        // Decrement blog post parent comment count
        await BlogPost.findByIdAndUpdate(req.params.blogId, {
          $inc: { commentsCount: -1 },
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
  getCommentReplies,
  acceptComment,
};
