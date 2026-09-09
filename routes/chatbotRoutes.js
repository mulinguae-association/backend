/**
 * Chatbot Routes
 * API endpoints for the AI chatbot feature.
 */

import express from "express";
import {
  handleChatMessage,
  handleChatMessageSync,
  checkRateLimit,
  listConversations,
  getConversationHistory,
} from "../controllers/chatbotController.js";
import { createChatbotRateLimiter } from "../middleware/rateLimitMiddleware.js";
import authenticateUser from "../middleware/authMiddlewar.js";
import optionalAuth from "../middleware/optionalAuthMiddleware.js";

const router = express.Router();

// Create rate limiter with configurable limits
const chatbotRateLimiter = createChatbotRateLimiter({
  minuteLimit: 20,
  hourLimit: 100,
});

// Apply rate limiting to all chatbot routes
router.use(chatbotRateLimiter);

/**
 * POST /api/chatbot/chat
 * Send a message and receive a streaming response.
 * Optional auth: logged-in users get their conversations persisted.
 */
router.post("/chat", optionalAuth, handleChatMessage);

/**
 * POST /api/chatbot/chat/sync
 * Send a message and receive a complete (non-streaming) response.
 * Optional auth: logged-in users get their conversations persisted.
 */
router.post("/chat/sync", optionalAuth, handleChatMessageSync);

/**
 * GET /api/chatbot/rate-limit
 * Check current rate limit status.
 */
router.get("/rate-limit", checkRateLimit);

// Protected conversation routes (require authentication)
router.get("/conversations", authenticateUser, listConversations);
router.get(
  "/conversations/:conversationId",
  authenticateUser,
  getConversationHistory,
);

export default router;
