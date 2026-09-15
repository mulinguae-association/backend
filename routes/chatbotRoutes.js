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
import {
  indexKnowledgeBase,
  getEmbeddingCount,
} from "../services/knowledgeEmbeddings.js";
import {
  invalidateChatCache,
  invalidateRagCache,
} from "../services/chatCacheService.js";

/**
 * Middleware: require authenticated admin user.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const role = req.user.role || req.role;
  if (!["admin", "superadmin"].includes(role)) {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
};

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

/**
 * POST /api/chatbot/reindex
 * Re-index knowledge base embeddings into MongoDB. Admin only.
 */
router.post("/reindex", authenticateUser, requireAdmin, async (req, res) => {
  try {
    const result = await indexKnowledgeBase();
    const [cleared, clearedRag] = await Promise.all([
      invalidateChatCache(),
      invalidateRagCache(),
    ]);
    res.json({
      message: `Reindexed ${result.indexed} chunks, cleared ${cleared + clearedRag} cached entries.`,
      indexed: result.indexed,
      totalChunks: result.chunks,
      cacheCleared: cleared,
      ragCacheCleared: clearedRag,
    });
  } catch (err) {
    console.error("Reindex error:", err);
    res.status(500).json({ error: "Reindex failed: " + err.message });
  }
});

/**
 * GET /api/chatbot/embedding-count
 * Check how many knowledge embeddings exist. Admin only.
 */
router.get(
  "/embedding-count",
  authenticateUser,
  requireAdmin,
  async (req, res) => {
    try {
      const count = await getEmbeddingCount();
      res.json({ count });
    } catch (err) {
      res.status(500).json({ error: "Failed to get embedding count." });
    }
  },
);

export default router;
