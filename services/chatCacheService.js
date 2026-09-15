/**
 * Chat cache (Upstash Redis).
 * - Response cache: exact question -> answer (single-turn, fresh conversations).
 * - RAG context cache: question -> retrieved knowledge chunks, so repeated
 *   queries skip embedding + Atlas vector search entirely.
 */

import crypto from "crypto";
import { getRedisClient } from "./redisClient.js";

const RESPONSE_TTL = 60 * 60; // 1 hour
const RAG_TTL = 6 * 60 * 60; // 6 hours
const RESPONSE_PREFIX = "chatbot:cache:";
const RAG_PREFIX = "chatbot:rag:";

const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

const makeKey = (prefix, domain, text) =>
  `${prefix}${domain}:${crypto
    .createHash("sha256")
    .update(normalize(text))
    .digest("hex")
    .slice(0, 16)}`;

const get = async (key) => {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const value = await client.get(key);
    return typeof value === "string" ? value : null;
  } catch (err) {
    console.warn("[chatCache] get failed:", err.message);
    return null;
  }
};

const set = async (key, content, ttl) => {
  const client = getRedisClient();
  if (!client || !content) return;
  try {
    await client.set(key, content, { ex: ttl });
  } catch (err) {
    console.warn("[chatCache] set failed:", err.message);
  }
};

export const getCachedResponse = (message, domain = "general") =>
  get(makeKey(RESPONSE_PREFIX, domain, message));

export const cacheResponse = (
  message,
  domain = "general",
  content,
  ttl = RESPONSE_TTL,
) => set(makeKey(RESPONSE_PREFIX, domain, message), content, ttl);

export const getCachedRagContext = (query, domain = "general") =>
  get(makeKey(RAG_PREFIX, domain, query));

export const cacheRagContext = (
  query,
  domain = "general",
  content,
  ttl = RAG_TTL,
) => set(makeKey(RAG_PREFIX, domain, query), content, ttl);

const clearByPattern = async (prefix, domain) => {
  const client = getRedisClient();
  if (!client) return 0;
  const pattern = domain ? `${prefix}${domain}:*` : `${prefix}*`;
  let cursor = 0;
  let deleted = 0;
  try {
    do {
      const result = await client.scan(cursor, { match: pattern, count: 100 });
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (String(cursor) !== "0");
  } catch (err) {
    console.warn("[chatCache] invalidate failed:", err.message);
  }
  return deleted;
};

export const invalidateChatCache = (domain) =>
  clearByPattern(RESPONSE_PREFIX, domain);

export const invalidateRagCache = (domain) => clearByPattern(RAG_PREFIX, domain);

export default {
  getCachedResponse,
  cacheResponse,
  getCachedRagContext,
  cacheRagContext,
  invalidateChatCache,
  invalidateRagCache,
};