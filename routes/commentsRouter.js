import express from "express";
import {
  createComment, // Added: Import createComment function
  deleteComment, // Added: Import deleteComment function
  createReplyComment,
  updatedComment,
  getAcceptedComments,
  getCommentReplies,
} from "../controllers/commentController.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import { createSubmissionRateLimiter } from "../middleware/rateLimitMiddleware.js";
import updateInteraction from "../controllers/ineractionsController.js";
const router = express.Router();

// Comments and replies share one quota: both cost a moderation call, and a
// reply is a comment. 60/hour and 600/day are far above human reading pace.
const commentRateLimiter = createSubmissionRateLimiter({
  keyPrefix: "comment",
  windows: [
    { limit: 60, windowSeconds: 3600 },
    { limit: 600, windowSeconds: 86400 },
  ],
  errorMessage:
    "You are commenting too quickly. Please wait before posting again.",
});

// API route for adding a comment to a blog post
router.post("/:id", authenticateUser, commentRateLimiter, createComment);
router.post(
  "/reply/:id",
  authenticateUser,
  commentRateLimiter,
  createReplyComment,
);

router.patch("/update/:id", authenticateUser, updatedComment);

// API route for deleting a comment from a blog post
router.delete("/:commentId/:blogId", authenticateUser, deleteComment);
// interaction with comments
router.post("/:modelType/:id/:action", authenticateUser, updateInteraction);

//admin
router.get("/replies/:parentCommentId", getCommentReplies);
router.get("/:blogId/accepted", getAcceptedComments);

export default router;
