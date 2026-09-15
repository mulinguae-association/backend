/**
 * Rate limiting middleware for chatbot endpoints.
 * Uses Upstash Redis for distributed limits (works across serverless instances).
 * Limits: 20 msg/min and 100 msg/hour per IP by default.
 */

import { getRedisClient } from "../services/redisClient.js";
import { getClientIP } from "../utils/request.js";

/**
 * Sliding-window rate limit check for a key.
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number, total: number}>}
 */
const checkRateLimit = async (key, limit, windowSeconds) => {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const client = getRedisClient();

  const allowed = (remaining = limit) => ({
    allowed: true,
    remaining,
    resetAt: Math.ceil((now + windowSeconds * 1000) / 1000),
    total: limit,
  });

  if (!client) return allowed();

  try {
    const pipeline = client.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    pipeline.expire(key, windowSeconds);

    const results = await pipeline.exec();
    const currentCount = results[1];

    if (currentCount >= limit) {
      const oldest = await client.zrange(key, 0, 0, { withScores: true });
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

    return allowed(limit - currentCount - 1);
  } catch (error) {
    console.error("[rateLimit] check failed:", error);
    return allowed(); // fail open
  }
};

/**
 * Rate limit middleware factory for chatbot endpoints.
 */
export const createChatbotRateLimiter = ({
  minuteLimit = 20,
  hourLimit = 100,
} = {}) => {
  return async (req, res, next) => {
    const clientIP = getClientIP(req);

    const [minute, hour] = await Promise.all([
      checkRateLimit(`ratelimit:chatbot:minute:${clientIP}`, minuteLimit, 60),
      checkRateLimit(`ratelimit:chatbot:hour:${clientIP}`, hourLimit, 3600),
    ]);

    req.rateLimit = { minute, hour };

    res.setHeader("X-RateLimit-Limit-Minute", minuteLimit);
    res.setHeader("X-RateLimit-Remaining-Minute", minute.remaining);
    res.setHeader("X-RateLimit-Reset-Minute", minute.resetAt);
    res.setHeader("X-RateLimit-Limit-Hour", hourLimit);
    res.setHeader("X-RateLimit-Remaining-Hour", hour.remaining);
    res.setHeader("X-RateLimit-Reset-Hour", hour.resetAt);

    const exceeded = !minute.allowed ? minute : !hour.allowed ? hour : null;
    if (exceeded) {
      const retryAfter = exceeded.resetAt - Math.ceil(Date.now() / 1000);
      res.setHeader("Retry-After", Math.max(1, retryAfter));
      return res.status(429).json({
        error: "Chatbot rate limit exceeded. Please try again later.",
        retryAfter,
      });
    }

    next();
  };
};

export default { createChatbotRateLimiter };