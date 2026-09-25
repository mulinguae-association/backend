/**
 * Rate limit middleware for chatbot endpoints.
 * Uses Upstash Redis for distributed limits (works across serverless instances).
 * Limits: 20 msg/min and 100 msg/hour per IP by default.
 */

import { getRedisClient } from "../services/redisClient.js";
import { getClientIP } from "../utils/request.js";
import problem from "../utils/problem.js";

/**
 * Sliding-window rate limit check for a key.
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number, total: number}>}
 */
export const checkRateLimit = async (key, limit, windowSeconds) => {
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
      // Upstash returns [member, score] as a flat pair, not { score }.
      const oldestScore = Number(oldest[1]);
      const resetAt =
        Number.isFinite(oldestScore) && oldestScore > 0
          ? oldestScore + windowSeconds * 1000
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
      return problem(res, {
        req,
        status: 429,
        code: "RATE_LIMITED",
        title: "Rate limit exceeded",
        detail: "Chatbot rate limit exceeded. Please try again later.",
        extensions: { retryAfter },
      });
    }

    next();
  };
};

/**
 * Rate limit for content submission, keyed on the authenticated user rather
 * than IP so a shared connection (a classroom behind one NAT, a campus) cannot
 * exhaust a shared quota, and so a caller cannot rotate IPs to reset it.
 *
 * Limits are set far above genuine human rates: a burst is turned away before
 * it reaches moderation, so this saves tokens rather than policing people.
 * Fails open when Redis is unavailable — losing the cap degrades to the token
 * budget guard, which still refuses to spend once the day's allowance is gone.
 */
export const createSubmissionRateLimiter = ({
  keyPrefix,
  windows,
  errorMessage,
}) => {
  return async (req, res, next) => {
    const client = getRedisClient();
    if (!client) return next();

    const identity = req.userId ? `u:${req.userId}` : `ip:${getClientIP(req)}`;
    let exceeded = null;

    for (const { limit, windowSeconds } of windows) {
      const result = await checkRateLimit(
        `ratelimit:${keyPrefix}:${windowSeconds}:${identity}`,
        limit,
        windowSeconds,
      );
      if (!result.allowed && !exceeded) exceeded = result;
    }

    if (!exceeded) return next();

    const retryAfter = Math.max(
      1,
      exceeded.resetAt - Math.ceil(Date.now() / 1000),
    );
    res.setHeader("Retry-After", retryAfter);
    return problem(res, {
      req,
      status: 429,
      code: "RATE_LIMITED",
      title: "Rate limit exceeded",
      detail: errorMessage,
      extensions: { retryAfter },
    });
  };
};

export default { createChatbotRateLimiter, createSubmissionRateLimiter };