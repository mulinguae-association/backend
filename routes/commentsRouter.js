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
import updateInteraction from "../controllers/ineractionsController.js";
const router = express.Router();

// API route for adding a comment to a blog post
router.post("/:id", authenticateUser, createComment);
router.post("/reply/:id", authenticateUser, createReplyComment);

router.patch("/update/:id", authenticateUser, updatedComment);

// API route for deleting a comment from a blog post
router.delete("/:commentId/:blogId", authenticateUser, deleteComment);
// interaction with comments
router.post("/:modelType/:id/:action", authenticateUser, updateInteraction);

//admin
router.get("/replies/:parentCommentId", getCommentReplies);
router.get("/:blogId/accepted", getAcceptedComments);

export default router;
