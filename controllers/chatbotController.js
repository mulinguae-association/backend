/**
 * Chatbot Controller
 * Handles all chatbot-related API endpoints including
 * message processing, conversation management, and streaming responses.
 */

import {
  getGroqCompletion,
  buildGroqMessages,
} from "../services/groqService.js";
import {
  getGroqHistory,
  saveMessage,
  getConversation,
  getUserConversations,
} from "../services/conversationService.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Get the client IP address from the request.
 * Works with various proxy configurations.
 */
const getClientIP = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
};

/**
 * POST /api/chatbot/chat
 * Send a message and receive a streamed response from Groq.
 *
 * Body: { message: string, conversationId?: string, domain?: string }
 */
export const handleChatMessage = async (req, res) => {
  try {
    const { message, conversationId, domain = "general" } = req.body;
    const userId = req.user ? req.user._id : null;
    const clientIP = getClientIP(req);

    // Validate input
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required." });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      return res.status(400).json({ error: "Message cannot be empty." });
    }
    if (trimmedMessage.length > 4000) {
      return res.status(400).json({ error: "Message exceeds maximum length." });
    }

    const isAuthed = Boolean(userId);

    // Generate a conversation ID if not provided
    const activeConversationId = conversationId || `${clientIP}-${uuidv4()}`;

    // Conversation history is only loaded/persisted for authenticated users.
    let conversationHistory = [];
    if (isAuthed && conversationId) {
      conversationHistory = await getGroqHistory(activeConversationId, userId);
    }

    // Build messages for Groq
    const messages = buildGroqMessages(domain, conversationHistory);

    // Add current user message
    messages.push({
      role: "user",
      content: trimmedMessage,
    });

    // For streaming responses, we set appropriate headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send to Groq with streaming
    const groqResponse = await getGroqCompletion({
      messages,
      stream: true,
    });

    let fullContent = "";

    // Notify client of the active conversation ID (only persisted for authed users)
    if (isAuthed) {
      res.write(
        `data: ${JSON.stringify({ conversationId: activeConversationId })}\n\n`,
      );
    }

    // Process the streaming response
    groqResponse.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    });

    groqResponse.on("end", async () => {
      try {
        if (isAuthed) {
          await saveMessage(
            activeConversationId,
            { role: "user", content: trimmedMessage, timestamp: Date.now() },
            { userId, domain },
          );
          if (fullContent) {
            await saveMessage(
              activeConversationId,
              {
                role: "assistant",
                content: fullContent,
                timestamp: Date.now(),
              },
              { userId, domain },
            );
          }
        }
      } catch (err) {
        console.error("Failed to save conversation:", err);
      }
      res.end();
    });

    groqResponse.on("error", (err) => {
      console.error("Groq streaming error:", err);
      res.status(500).json({ error: "Failed to get response from AI." });
    });

    // Handle client disconnect
    req.on("close", () => {
      groqResponse.destroy();
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};

/**
 * POST /api/chatbot/chat/sync
 * Send a message and receive a complete (non-streaming) response.
 * Useful for simpler integrations.
 *
 * Body: { message: string, domain?: string }
 */
export const handleChatMessageSync = async (req, res) => {
  try {
    const { message, conversationId, domain = "general" } = req.body;
    const userId = req.user ? req.user._id : null;
    const isAuthed = Boolean(userId);

    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.status(400).json({ error: "Message is required." });
    }

    const trimmedMessage = message.trim();
    const clientIP = getClientIP(req);
    const activeConversationId = conversationId || `${clientIP}-${uuidv4()}`;

    let conversationHistory = [];
    if (isAuthed && conversationId) {
      conversationHistory = await getGroqHistory(activeConversationId, userId);
    }
    const messages = buildGroqMessages(domain, conversationHistory);
    messages.push({ role: "user", content: trimmedMessage });

    const groqResponse = await getGroqCompletion({
      messages,
      stream: false,
    });

    const content = groqResponse.choices?.[0]?.message?.content || "";

    // Only persist conversations for authenticated users.
    if (isAuthed) {
      await saveMessage(
        activeConversationId,
        { role: "user", content: trimmedMessage, timestamp: Date.now() },
        { userId, domain },
      );
      if (content) {
        await saveMessage(
          activeConversationId,
          { role: "assistant", content, timestamp: Date.now() },
          { userId, domain },
        );
      }
    }

    res.json({
      conversationId: isAuthed ? activeConversationId : null,
      content,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Chat sync error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};

/**
 * GET /api/chatbot/rate-limit
 * Check current rate limit status for the requesting IP.
 */
export const checkRateLimit = async (req, res) => {
  try {
    const clientIP = getClientIP(req);
    // Rate limit data is set by the rateLimitMiddleware
    const rateLimitData = req.rateLimit || {};

    res.json({
      ip: clientIP,
      ...rateLimitData,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to check rate limit." });
  }
};

/**
 * GET /api/chatbot/conversations
 * List all conversations for the authenticated user.
 * Returns conversation blocks (id, domain, last message, timestamp).
 * Requires authentication.
 */
export const listConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const conversations = await getUserConversations(userId, {
      limit: parseInt(req.query.limit) || 20,
      skip: parseInt(req.query.skip) || 0,
    });

    // Format for the frontend: return lightweight blocks with the last message
    const blocks = conversations.map((conv) => ({
      conversationId: conv.conversationId,
      domain: conv.domain,
      lastMessage:
        conv.messages.length > 0
          ? conv.messages[conv.messages.length - 1].content
          : "",
      messageCount: conv.messages.length,
      updatedAt: conv.updatedAt,
    }));

    res.json({ conversations: blocks });
  } catch (error) {
    console.error("List conversations error:", error);
    res.status(500).json({ error: "Failed to fetch conversations." });
  }
};

/**
 * GET /api/chatbot/conversations/:conversationId
 * Get full message history for a specific conversation.
 * Requires authentication and ownership.
 */
export const getConversationHistory = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const conversation = await getConversation(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    res.json({
      conversationId: conversation.conversationId,
      domain: conversation.domain,
      messages: conversation.messages,
      updatedAt: conversation.updatedAt,
    });
  } catch (error) {
    console.error("Get conversation history error:", error);
    res.status(500).json({ error: "Failed to fetch conversation." });
  }
};

export default {
  handleChatMessage,
  handleChatMessageSync,
  checkRateLimit,
  listConversations,
  getConversationHistory,
};
