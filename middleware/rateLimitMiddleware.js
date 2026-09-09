/**
 * Rate Limiting Middleware for Chatbot
 * Uses Upstash Redis for distributed rate limiting.
 *
 * This middleware is designed for serverless environments (Vercel) where
 * traditional in-memory rate limiting doesn't work across instances.
 *
 * Rate Limits:
 * - 20 messages per minute per IP (free tier)
 * - 100 messages per hour per IP
 *
 * Future: Can be extended to rate limit per user ID when authenticated.
 */

import { Redis } from "@upstash/redis";

// Initialize Upstash Redis client.
// Fail gracefully if env vars are missing (e.g., local dev without Upstash),
// so the rate limiter falls back to "allow" instead of crashing the server.
let redis = null;
const hasUpstashConfig =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

if (hasUpstashConfig) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (err) {
    console.warn(
      "Upstash Redis init failed, rate limiting will be relaxed:",
      err.message,
    );
    redis = null;
  }
}

/**
 * Get client IP from request headers.
 * Handles various proxy configurations (Vercel, nginx, etc.)
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
 * Check and increment rate limit for a given key.
 * Uses sliding window algorithm for accurate rate limiting.
 *
 * @param {string} key - The rate limit key (e.g., "ratelimit:chatbot:ip:192.168.1.1")
 * @param {number} limit - Max allowed requests in the window
 * @param {number} windowSeconds - Window size in seconds
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
const checkRateLimit = async (key, limit, windowSeconds) => {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    // If Upstash is not configured, fail open (allow the request)
    if (!redis) {
      return {
        allowed: true,
        remaining: limit,
        resetAt: Math.ceil((now + windowSeconds * 1000) / 1000),
        total: limit,
      };
    }

    // Use a Redis transaction for atomic operations
    const pipeline = redis.pipeline();

    // Remove old entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    pipeline.zcard(key);

    // Add current request with timestamp as score
    pipeline.zadd(key, { score: now, member: `${now}-${Math.random()}` });

    // Set expiry on the key
    pipeline.expire(key, windowSeconds);

    const results = await pipeline.exec();

    const currentCount = results[1]; // zcard result

    if (currentCount >= limit) {
      // Get the oldest request in the window to calculate reset time
      const oldest = await redis.zrange(key, 0, 0, { withScores: true });
      const resetAt =
        oldest.length > 0
          ? oldest[0].score + windowSeconds * 1000
          : now + windowSeconds * 1000;

      return {
        allowed: false,
        remaining: 0,
        resetAt: Math.ceil(resetAt / 1000),
        total: limit,
      };
    }

    return {
      allowed: true,
      remaining: limit - currentCount - 1,
      resetAt: Math.ceil((now + windowSeconds * 1000) / 1000),
      total: limit,
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // Fail open - allow the request if Redis is unavailable
    return {
      allowed: true,
      remaining: limit,
      resetAt: Math.ceil((now + windowSeconds * 1000) / 1000),
      total: limit,
    };
  }
};

/**
 * Rate limit middleware factory for chatbot endpoints.
 *
 * @param {object} options
 * @param {number} [options.minuteLimit=20] - Max requests per minute
 * @param {number} [options.hourLimit=100] - Max requests per hour
 * @returns {function} Express middleware
 */
export const createChatbotRateLimiter = ({
  minuteLimit = 20,
  hourLimit = 100,
} = {}) => {
  return async (req, res, next) => {
    const clientIP = getClientIP(req);

    // Check per-minute limit
    const minuteKey = `ratelimit:chatbot:minute:${clientIP}`;
    const minuteResult = await checkRateLimit(minuteKey, minuteLimit, 60);

    // Check per-hour limit
    const hourKey = `ratelimit:chatbot:hour:${clientIP}`;
    const hourResult = await checkRateLimit(hourKey, hourLimit, 3600);

    // Attach rate limit info to request for use in controllers
    req.rateLimit = {
      minute: minuteResult,
      hour: hourResult,
    };

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit-Minute", minuteLimit);
    res.setHeader("X-RateLimit-Remaining-Minute", minuteResult.remaining);
    res.setHeader("X-RateLimit-Reset-Minute", minuteResult.resetAt);

    res.setHeader("X-RateLimit-Limit-Hour", hourLimit);
    res.setHeader("X-RateLimit-Remaining-Hour", hourResult.remaining);
    res.setHeader("X-RateLimit-Reset-Hour", hourResult.resetAt);

    // If either limit is exceeded, reject the request
    // if (!minuteResult.allowed) {
    //   return res.status(429).json({
    //     error: "Too many requests. Please wait a moment before sending another message.",
    //     retryAfter: minuteResult.resetAt - Math.ceil(Date.now() / 1000),
    //   });
    // }

    // if (!hourResult.allowed) {
    //   return res.status(429).json({
    //     error: "Hourly message limit reached. Please try again later.",
    //     retryAfter: hourResult.resetAt - Math.ceil(Date.now() / 1000),
    //   });
    // }

    next();
  };
};

/**
 * Simple in-memory rate limiter for development/fallback.
 * Note: Does NOT work in serverless environments across instances.
 */
const memoryStore = new Map();

export const createInMemoryRateLimiter = ({
  minuteLimit = 20,
  hourLimit = 100,
} = {}) => {
  return async (req, res, next) => {
    const clientIP = getClientIP(req);
    const now = Date.now();

    if (!memoryStore.has(clientIP)) {
      memoryStore.set(clientIP, { minute: [], hour: [] });
    }

    const clientData = memoryStore.get(clientIP);

    // Clean old entries
    clientData.minute = clientData.minute.filter((t) => now - t < 60000);
    clientData.hour = clientData.hour.filter((t) => now - t < 3600000);

    // Check limits
    if (clientData.minute.length >= minuteLimit) {
      return res.status(429).json({
        error: "Too many requests. Please wait a moment.",
        retryAfter: Math.ceil((clientData.minute[0] + 60000 - now) / 1000),
      });
    }

    if (clientData.hour.length >= hourLimit) {
      return res.status(429).json({
        error: "Hourly message limit reached.",
        retryAfter: Math.ceil((clientData.hour[0] + 3600000 - now) / 1000),
      });
    }

    // Record this request
    clientData.minute.push(now);
    clientData.hour.push(now);

    next();
  };
};

export default {
  createChatbotRateLimiter,
  createInMemoryRateLimiter,
};
