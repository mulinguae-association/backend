import express from "express";
import {
  createBlogPost,
  deleteBlogPost,
  getAcceptedBlogPosts,
  searchBlogPosts,
} from "../controllers/blogPostController.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import updateInteraction from "../controllers/ineractionsController.js";
const router = express.Router();

// API route for submitting a blog post
router.post("/", authenticateUser, createBlogPost);
router.get("/accepted", getAcceptedBlogPosts);

// API route for deleting a blog post
router.delete("/:id", authenticateUser, deleteBlogPost);

// api route for search a blog post 
router.get("/search", searchBlogPosts);

router.post("/:modelType/:id/:action", authenticateUser, updateInteraction);

export default router;
