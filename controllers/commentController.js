// Import your modules here
import mongoose from "mongoose";
import BlogPost from "../db/models/BlogPost.js";
import Comment from "../db/models/Comment.js";
import User from "../db/models/User.js";
import { isAdminRole } from "../utils/isAdminRole.js";
import {
  moderateSafety,
  ModerationUnavailableError,
} from "../services/moderationService.js";
import problem from "../utils/problem.js";
import {
  toCommentPayload,
  commentCreated,
  commentUpdated,
  commentDeleted,
} from "../websocket/comments/events.js";
import {
  DELETION_MODE,
  LISTABLE_COMMENT_STATUSES,
  DELETED_COMMENT_STATUS,
  buildTombstoneUpdate,
  buildDeletionEvent,
  resolveDeletionMode,
  resolveDeletionActor,
  LIVE_COMMENT_STATUS,
} from "../services/comments/deletionPolicy.js";

const REJECTED_STATUS = 422;
const UNAVAILABLE_STATUS = 503;
const CONFLICT_STATUS = 409;

/**
 * Screen content before it is persisted. Returns true when the content may be
 * saved. Sends the response and returns false when it may not.
 */
async function screenContent(res, { content, type }) {
  try {
    const { allowed } = await moderateSafety({ content, type });

    if (allowed) return true;

    console.log(`[moderation] rejected ${type}`);
    problem(res, {
      status: REJECTED_STATUS,
      code: "CONTENT_REJECTED",
      title: "Content rejected",
      detail: "Your comment could not be published.",
    });
    return false;
  } catch (error) {
    if (error instanceof ModerationUnavailableError) {
      // Fail closed: an unavailable moderator must never let content through.
      problem(res, {
        status: UNAVAILABLE_STATUS,
        code: "MODERATION_UNAVAILABLE",
        title: "Moderation unavailable",
        detail: "Your comment could not be published. Please try again later.",
      });
      return false;
    }
    throw error;
  }
}

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
      return problem(res, {
        req,
        status: 404,
        code: "BLOG_NOT_FOUND",
        title: "Blog post not found",
      });
    }

    if (!(await screenContent(res, { content, type: "comment-safety" }))) {
      return;
    }

    const comment = new Comment({
      content,
      blogId: id,
      postedBy: authorId,
      parentComment: null,
      status: "accepted",
    });

    await comment.save();

    // Increment parent comment count on BlogPost atomically
    await BlogPost.findByIdAndUpdate(id, { $inc: { commentsCount: 1 } });
    const payload = toCommentPayload(comment, author);
    // Fan out to everyone currently interested in the blog; delivery is driven
    // by room subscription, not by post ownership.
    commentCreated(id, payload);

    res
      .status(201)
      .json({ message: "Comment added successfully", comment: payload });
  } catch (error) {
    console.error("Error adding comment:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}
async function updatedComment(req, res) {
  const { id } = req.params;
  const { content } = req.body;
  try {
    // Find the blog post with the provided ID
    const comment = await Comment.findById(id);
    if (!comment) {
      return problem(res, {
        req,
        status: 404,
        code: "COMMENT_NOT_FOUND",
        title: "Comment not found",
      });
    }
    if (comment.status === DELETED_COMMENT_STATUS) {
      return problem(res, {
        req,
        status: CONFLICT_STATUS,
        code: "COMMENT_DELETED",
        title: "Comment was deleted",
        detail: "A deleted comment cannot be edited.",
      });
    }

    if (
      comment.postedBy._id.toString() !== req.userId.toString() &&
      !isAdminRole(req.role)
    ) {
      return problem(res, {
        req,
        status: 403,
        code: "COMMENT_NOT_EDITABLE",
        title: "No permission to edit comment",
      });
    }

    // Screened after the ownership check so an unauthorised edit costs no
    // moderation call, and the edit is all-or-nothing like creation.
    if (!(await screenContent(res, { content, type: "comment-edit-safety" }))) {
      return;
    }

    // Update the comment content. The lifecycle status is deliberately left
    // alone: an edit is not a lifecycle transition, and updatedAt is what
    // records that it happened. Clients order comment.updated payloads by it
    // and mark the comment as edited from it.
    comment.content = content;
    comment.updatedAt = new Date();

    // Save the updated comment
    await comment.save();

    // The author is re-read rather than reused: an edit never populates
    // postedBy, so the document only carries the raw id. Shipping the id would
    // make a client overwrite a good cached author summary with a bare string.
    const author = await User.findById(comment.postedBy);
    const payload = toCommentPayload(comment, author);

    // The room comes from the stored blogId, not the request: the update route
    // has no blogId segment, and a caller could not be trusted to supply one.
    commentUpdated(comment.blogId, payload);

    // The comment is returned as well as broadcast so the editor that made the
    // change does not depend on receiving its own event to settle.
    res
      .status(201)
      .json({ message: "Comment updated successfully", comment: payload });
  } catch (error) {
    console.error("Error updating comment:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

// Create a reply comment referenced by the parent via the flat parentComment
// field. A tombstone is a valid parent: its row is still there, which is what
// keeps a reply under a deleted comment rendering in the right place.
async function createReplyComment(req, res) {
  const { content, blogId, parentCommentId } = req.body;
  const authorId = req.userId;
  try {
    const parentComment = await Comment.findById(parentCommentId);
    // find author info
    const author = await User.findById(authorId);
    if (!parentComment) {
      return problem(res, {
        req,
        status: 404,
        code: "COMMENT_NOT_FOUND",
        title: "Parent comment not found",
      });
    }

    if (!(await screenContent(res, { content, type: "reply-safety" }))) {
      return;
    }

    const replyComment = new Comment({
      content,
      blogId,
      postedBy: authorId,
      parentComment: parentCommentId,
      status: "accepted",
    });

    await replyComment.save();

    // Atomically update lastReply on blog post
    await BlogPost.findByIdAndUpdate(blogId, {
      $set: { lastReply: replyComment._id },
    });
    // A plain object, not the document: assigning the summary onto the document
    // path would be cast back to a bare id by the ObjectId path setter.
    const replyPayload = toCommentPayload(replyComment, author);
    commentCreated(blogId, replyPayload);

    return res
      .status(201)
      .json({ message: "Reply added successfully", comment: replyPayload });
  } catch (error) {
    console.error("Error adding reply comment:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
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
  // many replies they have without loading them. Tombstones are counted here:
  // they are still listed under their parent, so a badge that ignored them
  // would disagree with the rows directly beneath it.
  async function attachReplyCounts(comments) {
    const ids = comments.map((comment) => comment._id).filter(Boolean);
    const rows = ids.length
      ? await Comment.aggregate([
          {
            $match: {
              parentComment: { $in: ids },
              status: { $in: LISTABLE_COMMENT_STATUSES },
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
    // Pin the newest accepted parent comment onto page 1 so the blog feed can
    // always preview it without loading later pages. Its newest reply used to
    // be pinned beside it, but the card reads acceptedComments[0] alone and the
    // popup already lists that reply under its own parent, so pinning it here
    // rendered the same reply twice.
    //
    // The preview stays live-only. It is a teaser, and a card whose preview is a
    // bare "This comment was deleted." is worse than one showing the next
    // comment that still has something to say.
    const newestParent = await Comment.findOne({
      blogId,
      status: LIVE_COMMENT_STATUS,
      parentComment: null,
    })
      .sort({ createdAt: -1 })
      .populate(populated)
      .lean();

    const pinned = [newestParent].filter(Boolean);
    const pinnedIds = pinned.map((comment) => comment._id);
    // How many of the remaining comments page 1 consumes after the pinned ones
    const restPerPage = Math.max(0, limitNum - pinned.length);
    // Remaining comments consumed by the pages before this one
    const restConsumed =
      pageNum === 1 ? 0 : restPerPage + (pageNum - 2) * limitNum;

    // Only top-level comments paginate on the blog query; replies are fetched
    // lazily per parent via the "show replies" button.
    // Skipped entirely when the page has no room: Mongoose reads limit(0) as
    // "no limit", so the card preview (limit=1, which the pinned comment
    // already fills) would otherwise load every accepted parent comment.
    let rest = [];
    if (pageNum === 1 ? restPerPage > 0 : limitNum > 0) {
      rest = await Comment.find(
        pinnedIds.length > 0
          ? {
              blogId,
              status: { $in: LISTABLE_COMMENT_STATUSES },
              parentComment: null,
              _id: { $nin: pinnedIds },
            }
          : {
              blogId,
              status: { $in: LISTABLE_COMMENT_STATUSES },
              parentComment: null,
            },
      )
        .sort({ createdAt: -1 })
        .skip(Math.max(0, restConsumed))
        .limit(pageNum === 1 ? restPerPage : limitNum)
        .populate(populated)
        .lean();
    }

    const acceptedComments = pageNum === 1 ? pinned.concat(rest) : rest;
    await attachReplyCounts(acceptedComments);

    // Live comments only. A tombstone is a visible row but not a comment, so it
    // is excluded here even though the list above renders it; this is the one
    // place the two notions deliberately disagree.
    const totalComments = await Comment.aggregate([
      {
        $match: {
          blogId: new mongoose.Types.ObjectId(blogId),
          status: LIVE_COMMENT_STATUS,
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
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

// Fetch accepted replies of a parent comment (older than `before` when given),
// used by the "show more replies" button of a thread.
async function getCommentReplies(req, res) {
  const { parentCommentId } = req.params;
  const { limit = 5, before } = req.query;
  try {
    // Replies are listed for every status a reader may see, so a reply that is
    // itself a tombstone still renders its own placeholder in place.
    const filter = {
      parentComment: parentCommentId,
      status: { $in: LISTABLE_COMMENT_STATUSES },
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
              status: { $in: LISTABLE_COMMENT_STATUSES },
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
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

async function deleteComment(req, res) {
  const { commentId } = req.params;
  const authorId = req.userId;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return problem(res, {
        req,
        status: 404,
        code: "COMMENT_NOT_FOUND",
        title: "Comment not found",
      });
    }

    // Already a tombstone. Deleting twice is not an error - the requested end
    // state already holds - so the same payload goes back rather than a
    // conflict, and the caller's second attempt still converges on the same
    // cache state.
    if (comment.status === DELETED_COMMENT_STATUS) {
      const existing = await Comment.countDocuments({
        parentComment: comment._id,
      });
      const event = buildDeletionEvent({
        commentId: comment._id,
        parentCommentId: comment.parentComment,
        mode: DELETION_MODE.TOMBSTONED,
        tombstone: {
          ...toCommentPayload(comment, null),
          repliesCount: existing,
        },
      });
      return res
        .status(200)
        .json({ message: "Comment deleted successfully", ...event });
    }

    const canManage =
      comment.postedBy?._id?.toString() === authorId.toString() ||
      isAdminRole(req.role);
    if (!canManage) {
      return problem(res, {
        req,
        status: 401,
        code: "UNAUTHORIZED",
        title: "Unauthorized action",
      });
    }

    // One row is affected, never a subtree. repliesCount answers whether this
    // is a leaf: it counts every child still listed in a thread, so a child
    // that is itself a tombstone keeps it above zero and the parent correctly
    // stays a tombstone instead of being deleted out from under it.
    const repliesCount = await Comment.countDocuments({
      parentComment: comment._id,
    });
    const mode = resolveDeletionMode({ repliesCount });
    const isParentComment = comment.parentComment === null;
    const parentCommentId = comment.parentComment;
    const removedAt = new Date();
    // Read before postedBy is cleared: the avatar is all the tombstone keeps.
    const author = await User.findById(comment.postedBy);

    let tombstone = null;
    if (mode === DELETION_MODE.TOMBSTONED) {
      // Built once and reused for both the write and the broadcast below:
      // recomputing it would let the stored row and the payload clients apply
      // describe two different deletions.
      const tombstoneUpdate = buildTombstoneUpdate(removedAt, {
        deletedAuthorAvatar: author?.profileImage,
        deletedBy: resolveDeletionActor({ actorRole: req.role }),
      });
      // Clear the body and the author in place rather than deleting the row:
      // the replies hanging off it keep a parent to render under, and the row
      // keeps _id/blogId/parentComment so a deep link to it still resolves.
      await Comment.updateOne({ _id: comment._id }, tombstoneUpdate);
      // Serialize the document before layering the tombstone fields over it.
      // repliesCount is computed and rides along, or the client's reply control
      // drops to zero and hides the replies.
      tombstone = {
        ...toCommentPayload(comment, null),
        ...tombstoneUpdate.$set,
        repliesCount,
      };
    } else {
      // A leaf has nothing pointing at it, so the row can go for good.
      await Comment.deleteOne({ _id: comment._id });
    }

    const event = buildDeletionEvent({
      commentId: comment._id,
      parentCommentId,
      mode,
      tombstone,
      removedAt,
    });
    // Published before the response so a subscriber is never behind the caller
    // that triggered the delete.
    commentDeleted(comment.blogId, event);

    if (isParentComment) {
      // Decrement blog post parent comment count. Uses the blog the comment
      // actually belonged to rather than the caller's route segment, so the
      // count and the event can never disagree about which blog changed. A
      // tombstone is not counted either, so both modes decrement.
      await BlogPost.findByIdAndUpdate(comment.blogId, {
        $inc: { commentsCount: -1 },
      });
    }

    // The authoritative outcome is returned as well as broadcast, so the tab
    // that issued the delete converges on exactly what the server did without
    // waiting for its own event.
    res.status(200).json({ message: "Comment deleted successfully", ...event });
  } catch (error) {
    console.error("Error deleting comment:", error);
    problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

// Export your functions
export {
  createComment,
  createReplyComment,
  updatedComment,
  deleteComment,
  getAcceptedComments,
  getCommentReplies,
};
