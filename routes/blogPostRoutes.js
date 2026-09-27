import express from "express";
import {
  createBlogPost,
  deleteBlogPost,
  getAcceptedBlogPosts,
  getBlogPostForEdit,
  getPublicBlogPost,
  searchBlogPosts,
  updateBlogPost,
} from "../controllers/blogPostController.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import {
  createSubmissionRateLimiter,
  interactionRateLimiter,
  blogEditRateLimiter,
  deleteRateLimiter,
} from "../middleware/rateLimitMiddleware.js";
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

// api route for search a blog post
router.get("/search", searchBlogPosts);

// Reading one post for the edit form, and editing it. Authored by the post's own
// author or an admin, checked in the controller. Declared after the two static
// GET paths above so "/accepted" and "/search" are never read as an id.
// "/public/:id" is the open, shareable read and is two segments, so it cannot
// collide with the one-segment "/:id" below.
router.get("/public/:id", getPublicBlogPost);
router.get("/:id", authenticateUser, getBlogPostForEdit);
router.put("/:id", authenticateUser, blogEditRateLimiter, updateBlogPost);

// API route for deleting a blog post
router.delete("/:id", authenticateUser, deleteRateLimiter, deleteBlogPost);

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
