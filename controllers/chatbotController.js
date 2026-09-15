/**
 * Chatbot Controller
 * Handles chatbot endpoints: streaming chat, sync chat, rate-limit info,
 * and conversation management.
 */

import {
  getGroqCompletion,
  buildGroqMessages,
} from "../services/groqService.js";
import {
  getCachedResponse,
  cacheResponse,
} from "../services/chatCacheService.js";
import {
  getGroqHistory,
  saveMessage,
  getConversation,
  getUserConversations,
} from "../services/conversationService.js";
import { getClientIP } from "../utils/request.js";
import { v4 as uuidv4 } from "uuid";

const writeEvent = (res, payload) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const newConversationId = (req) => `${getClientIP(req)}-${uuidv4()}`;

const parseMessage = (req) => {
  const { message, conversationId, domain = "general" } = req.body;
  if (!message || typeof message !== "string") {
    return { error: "Message is required." };
  }
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return { error: "Message cannot be empty." };
  if (trimmedMessage.length > 4000) {
    return { error: "Message exceeds maximum length." };
  }
  return { trimmedMessage, conversationId, domain };
};

const loadHistory = async (conversationId, userId) => {
  if (!conversationId || !userId) return [];
  return getGroqHistory(conversationId, userId);
};

const persist = async (conversationId, role, content, { userId, domain }) =>
  saveMessage(
    conversationId,
    { role, content, timestamp: Date.now() },
    { userId, domain },
  );

const persistPair = async (conversationId, userMessage, botMessage, opts) => {
  await persist(conversationId, "user", userMessage, opts);
  if (botMessage) await persist(conversationId, "assistant", botMessage, opts);
};

const buildMessages = async (domain, conversationId, userId, message) => {
  const history = await loadHistory(conversationId, userId);
  const messages = await buildGroqMessages(domain, history, message);
  messages.push({ role: "user", content: message });
  return messages;
};

/**
 * POST /api/chatbot/chat
 * Send a message and receive a streamed response from Groq.
 * Fresh conversations (no conversationId) hit the response cache first;
 * cached answers bypass the LLM entirely.
 */
export const handleChatMessage = async (req, res) => {
  try {
    const parsed = parseMessage(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { trimmedMessage, conversationId, domain } = parsed;

    const userId = req.user ? req.user._id : null;
    const isAuthed = Boolean(userId);
    const opts = { userId, domain };
    const isFresh = !conversationId;
    const activeConversationId = conversationId || newConversationId(req);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (isAuthed) writeEvent(res, { conversationId: activeConversationId });

    // Cache only applies to single-turn (fresh) conversations.
    const cached = isFresh
      ? await getCachedResponse(trimmedMessage, domain)
      : null;
    if (cached) {
      writeEvent(res, { content: cached });
      res.write("data: [DONE]\n\n");
      if (isAuthed) {
        await persistPair(activeConversationId, trimmedMessage, cached, opts);
      }
      return res.end();
    }

    const messages = await buildMessages(
      domain,
      conversationId,
      userId,
      trimmedMessage,
    );
    const groqResponse = await getGroqCompletion({ messages, stream: true });

    let fullContent = "";
    let buffer = "";
    groqResponse.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data: ")) continue;
        const payload = data.slice(6);
        if (payload === "[DONE]") {
          res.write("data: [DONE]\n\n");
          continue;
        }
        try {
          const content = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            writeEvent(res, { content });
          }
        } catch {
          // skip malformed frames
        }
      }
    });

    groqResponse.on("end", async () => {
      try {
        if (isAuthed) {
          await persistPair(
            activeConversationId,
            trimmedMessage,
            fullContent,
            opts,
          );
        }
        if (isFresh && fullContent) {
          await cacheResponse(trimmedMessage, domain, fullContent);
        }
      } catch (err) {
        console.error("[chatbot] save failed:", err);
      }
      res.end();
    });

    groqResponse.on("error", (err) => {
      console.error("[chatbot] stream error:", err);
      if (!res.headersSent) {
        return res
          .status(500)
          .json({ error: "Failed to get response from AI." });
      }
      writeEvent(res, { error: "Failed to get response from AI." });
      res.end();
    });

    req.on("close", () => groqResponse.destroy());
  } catch (error) {
    console.error("[chatbot] chat error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
};

/**
 * POST /api/chatbot/chat/sync
 * Send a message and receive a complete (non-streaming) response.
 * Uses the cache for fresh conversations.
 */
export const handleChatMessageSync = async (req, res) => {
  try {
    const parsed = parseMessage(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { trimmedMessage, conversationId, domain } = parsed;

    const userId = req.user ? req.user._id : null;
    const isAuthed = Boolean(userId);
    const opts = { userId, domain };
    const isFresh = !conversationId;
    const activeConversationId = conversationId || newConversationId(req);

    const cached = isFresh
      ? await getCachedResponse(trimmedMessage, domain)
      : null;
    if (cached) {
      if (isAuthed) {
        await persistPair(activeConversationId, trimmedMessage, cached, opts);
      }
      return res.json({
        conversationId: isAuthed ? activeConversationId : null,
        content: cached,
        timestamp: Date.now(),
        cached: true,
      });
    }

    const messages = await buildMessages(
      domain,
      conversationId,
      userId,
      trimmedMessage,
    );
    const groqResponse = await getGroqCompletion({ messages, stream: false });
    const content = groqResponse.choices?.[0]?.message?.content || "";

    if (isFresh && content) {
      await cacheResponse(trimmedMessage, domain, content);
    }
    if (isAuthed) {
      await persistPair(activeConversationId, trimmedMessage, content, opts);
    }

    res.json({
      conversationId: isAuthed ? activeConversationId : null,
      content,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[chatbot] sync error:", error.message);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
};

/**
 * GET /api/chatbot/rate-limit
 * Check current rate limit status for the requesting IP.
 */
export const checkRateLimit = async (req, res) => {
  try {
    res.json({ ip: getClientIP(req), ...(req.rateLimit || {}) });
  } catch (error) {
    res.status(500).json({ error: "Failed to check rate limit." });
  }
};

/**
 * GET /api/chatbot/conversations
 * List all conversations for the authenticated user (lightweight blocks).
 */
export const listConversations = async (req, res) => {
  try {
    const conversations = await getUserConversations(req.user._id, {
      limit: parseInt(req.query.limit) || 20,
      skip: parseInt(req.query.skip) || 0,
    });

    res.json({
      conversations: conversations.map((conv) => ({
        conversationId: conv.conversationId,
        domain: conv.domain,
        lastMessage: conv.lastMessage?.content || "",
        messageCount: conv.messageCount || 0,
        updatedAt: conv.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[chatbot] list conversations error:", error);
    res.status(500).json({ error: "Failed to fetch conversations." });
  }
};

/**
 * GET /api/chatbot/conversations/:conversationId
 * Get full message history for a specific conversation (ownership-checked).
 */
export const getConversationHistory = async (req, res) => {
  try {
    const conversation = await getConversation(
      req.params.conversationId,
      req.user._id,
    );
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
    console.error("[chatbot] get conversation error:", error);
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
