/**
 * Conversation Service
 * Handles conversation history storage and retrieval.
 * Uses the Conversation model for MongoDB persistence.
 *
 * Future improvements:
 * - Add Redis caching layer for faster access
 * - Implement conversation pruning for old messages
 * - Add conversation metadata (domain, user preferences)
 */

import Conversation from "../db/models/Conversation.js";
import mongoose from "mongoose";

/**
 * Save a message to a conversation.
 * Creates the conversation if it doesn't exist.
 *
 * @param {string} conversationId - Unique conversation ID
 * @param {object} message - Message object {role, content, timestamp}
 * @param {object} [options] - Optional parameters
 * @param {string} [options.userId] - User ID (for authenticated users)
 * @param {string} [options.domain] - Domain context
 * @returns {Promise<object>} Updated conversation
 */
export const saveMessage = async (
  conversationId,
  message,
  { userId = null, domain = "general" } = {},
) => {
  const now = Date.now();

  const conversation = await Conversation.findOneAndUpdate(
    { conversationId },
    {
      $setOnInsert: {
        conversationId,
        userId,
        createdAt: now,
        expiresAt: userId
          ? new Date(now + 30 * 24 * 60 * 60 * 1000) // 30 days for users
          : new Date(now + 24 * 60 * 60 * 1000), // 24 hours for anonymous
      },
      $push: {
        messages: {
          $each: [message],
          $slice: -100, // Keep only last 100 messages
        },
      },
      $set: {
        domain, // reflect the latest selected topic
        updatedAt: now,
      },
    },
    {
      upsert: true,
      new: true,
    },
  );

  return conversation;
};

/**
 * Get a conversation by ID, optionally scoped to a user.
 *
 * @param {string} conversationId - Unique conversation ID
 * @param {string} [userId] - Owning user ID (ownership check when provided)
 * @returns {Promise<object|null>} Conversation object or null
 */
export const getConversation = async (conversationId, userId) => {
  const query = { conversationId };
  if (userId) query.userId = userId;
  return Conversation.findOne(query).lean();
};

/**
 * Get conversation messages formatted for Groq.
 * Only returns messages if the conversation belongs to the given user.
 * Keeps the request small: last ~10 messages, each capped at 2000 chars.
 *
 * @param {string} conversationId - Unique conversation ID
 * @param {string} [userId] - Owning user ID (optional ownership check)
 * @param {number} [maxMessages=10] - Max messages to return
 * @returns {Promise<Array>} Array of messages in Groq format
 */
export const getGroqHistory = async (
  conversationId,
  userId,
  maxMessages = 10,
) => {
  const query = { conversationId };
  if (userId) query.userId = userId;

  const conversation = await Conversation.findOne(query)
    .select("messages")
    .lean();

  if (!conversation) return [];

  return conversation.messages.slice(-maxMessages).map((msg) => ({
    role: msg.role,
    content:
      msg.content.length > 2000
        ? `${msg.content.slice(0, 2000)}…`
        : msg.content,
  }));
};

/**
 * Clear conversation messages (keeps the conversation record).
 *
 * @param {string} conversationId - Unique conversation ID
 * @returns {Promise<object>} Updated conversation
 */
export const clearConversation = async (conversationId) => {
  return Conversation.findOneAndUpdate(
    { conversationId },
    {
      $set: {
        messages: [],
        updatedAt: Date.now(),
      },
    },
    { new: true },
  );
};

/**
 * Delete a conversation entirely.
 *
 * @param {string} conversationId - Unique conversation ID
 * @returns {Promise<object>} Deletion result
 */
export const deleteConversation = async (conversationId) => {
  return Conversation.deleteOne({ conversationId });
};

/**
 * Get all conversations for a user.
 *
 * @param {string|object} userId - User ID
 * @param {object} [options] - Query options
 * @param {number} [options.limit=20] - Max results
 * @param {number} [options.skip=0] - Skip count
 * @returns {Promise<Array>} Array of conversations
 */
export const getUserConversations = async (
  userId,
  { limit = 20, skip = 0 } = {},
) => {
  const userObjectId =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  return Conversation.aggregate([
    { $match: { userId: userObjectId } },
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        conversationId: 1,
        domain: 1,
        updatedAt: 1,
        lastMessage: { $arrayElemAt: ["$messages", -1] },
        messageCount: {
          $cond: {
            if: { $isArray: "$messages" },
            then: { $size: "$messages" },
            else: 0,
          },
        },
      },
    },
  ]);
};

export default {
  saveMessage,
  getConversation,
  getGroqHistory,
  clearConversation,
  deleteConversation,
  getUserConversations,
};
