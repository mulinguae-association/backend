/**
 * Shared Upstash Redis client (lazy singleton).
 * Centralizes connection setup so all services reuse one instance.
 */

import { Redis } from "@upstash/redis";

let redis = null;

export const getRedisClient = () => {
  if (redis) return redis;
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (err) {
    console.warn("[redis] init failed:", err.message);
  }
  return redis;
};

export default getRedisClient;