import express from "express";
import {
  createOrEditBlogPost,
  getPendingBlogPosts,
  acceptBlogPost,
  deleteBlogPost,
  getAcceptedBlogPosts,
  searchBlogPosts,
  getBlogPostById,
} from "../controllers/blogPostController.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import updateInteraction from "../controllers/ineractionsController.js";
const router = express.Router();

// API route for creating or editing a blog post (merged)
router.post("/", authenticateUser, createOrEditBlogPost);
router.get("/accepted", getAcceptedBlogPosts);

// API route for fetching a single blog post by ID
router.get("/accepted/:id", getBlogPostById);

// API route for deleting a blog post
router.delete("/:id", authenticateUser, deleteBlogPost);

// api route for search a blog post
router.get("/search", searchBlogPosts);

router.post("/:modelType/:id/:action", authenticateUser, updateInteraction);
// admin only
router.get("/pending", authenticateUser, getPendingBlogPosts);
router.patch("/:id/accept", authenticateUser, acceptBlogPost);

export default router;
