import express from "express";
import {
  createBlogPost,
  deleteBlogPost,
  getAcceptedBlogPosts,
  searchBlogPosts,
} from "../controllers/blogPostController.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import { createSubmissionRateLimiter, interactionRateLimiter } from "../middleware/rateLimitMiddleware.js";
import updateInteraction from "../controllers/ineractionsController.js";
const router = express.Router();

// A blog post costs two moderation calls, so the cap is far lower than for
// comments: a genuine author does not publish six posts an hour.
const blogRateLimiter = createSubmissionRateLimiter({
  keyPrefix: "blog",
  windows: [{ limit: 6, windowSeconds: 86400 }],
  errorMessage:
    "You have reached the daily limit for publishing blog posts. Please try again tomorrow.",
});

// API route for submitting a blog post
router.post("/", authenticateUser, blogRateLimiter, createBlogPost);
router.get("/accepted", getAcceptedBlogPosts);

// API route for deleting a blog post
router.delete("/:id", authenticateUser, deleteBlogPost);

// api route for search a blog post 
router.get("/search", searchBlogPosts);

// Reactions on a blog post. Shares the comment interaction bucket on purpose:
// it is the same limiter instance, so a user cannot get 120/hour here on top of
// 120/hour there.
router.post(
  "/:modelType/:id/:action",
  authenticateUser,
  interactionRateLimiter,
  updateInteraction,
);

export default router;
