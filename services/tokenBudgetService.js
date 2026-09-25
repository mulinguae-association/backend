/**
 * Daily token budget for moderation calls, enforced in Upstash Redis.
 *
 * Groq's free tier meters a daily token allowance per model id, so each model
 * gets its own counter. This is the last line of defence against a submission
 * flood or a spam bot draining the allowance and taking the site offline: when
 * the day's charged tokens approach the cap, moderation refuses new calls
 * instead of spending them.
 *
 * Fail-closed by design. If the counter cannot be read (no client configured,
 * or Redis unreachable) we refuse rather than guess, because a wrong guess in
 * the permissive direction is exactly the case that overspends the budget.
 */

import { getRedisClient } from "./redisClient.js";

// 200K tokens/day per model id on the free tier. Overridable so the guard can
// be exercised in tests without burning a real day's allowance.
const DAILY_BUDGET = Number(process.env.MODERATION_DAILY_TOKEN_BUDGET) || 200000;

// Stop before the hard cap so an in-flight call cannot overshoot it. ~2 cold
// calls of headroom; a cold call charges ~2.5K against a warm ~400.
const SAFETY_MARGIN = 5000;

// Charged tokens per call when Groq returns no usage block. Deliberately the
// cold-call figure: over-counting is the safe direction for a budget guard.
const FALLBACK_CALL_TOKENS = 2500;

const PREFIX = "moderation:budget";

export class ModerationBudgetError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ModerationBudgetError";
    this.cause = cause;
  }
}

const dayKey = (model) => `${PREFIX}:${new Date().toISOString().slice(0, 10)}:${model}`;

/**
 * Groq counts a cached prompt prefix against the token allowance at a discount,
 * so the budget tracks charged (non-cached) tokens: total minus the cached
 * prefix. This matches how the free-tier allowance is actually drawn down.
 */
export const chargedTokens = (usage) => {
  if (!usage || typeof usage.total_tokens !== "number") {
    return FALLBACK_CALL_TOKENS;
  }

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return Math.max(0, usage.total_tokens - cached);
};

const readSpent = async (client, model) => {
  const raw = await client.get(dayKey(model));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Refuse the call when the day's budget is spent, or when the spend cannot be
 * verified. Throws rather than returning a flag so the caller's existing
 * fail-closed path reports it as an unavailable moderator.
 *
 * @throws {ModerationBudgetError}
 */
export const assertBudgetAvailable = async (model) => {
  const client = getRedisClient();

  // No Redis means no way to know what has already been spent today.
  if (!client) {
    throw new ModerationBudgetError(
      "moderation budget unavailable: no Redis client configured",
    );
  }

  let spent;
  try {
    spent = await readSpent(client, model);
  } catch (error) {
    throw new ModerationBudgetError(
      "moderation budget unavailable: could not read spend",
      error,
    );
  }

  if (spent + SAFETY_MARGIN >= DAILY_BUDGET) {
    throw new ModerationBudgetError(
      `moderation budget exhausted for ${model}: ${spent}/${DAILY_BUDGET} tokens today`,
    );
  }
};

/**
 * Record what a completed call actually cost. Best-effort by design: the tokens
 * are already spent by the time this runs, so failing to account for them must
 * not also fail the user's submission. Losing a few tokens of accounting is
 * preferable to rejecting valid content.
 */
export const recordSpend = async (model, usage) => {
  const client = getRedisClient();
  if (!client) return;

  const tokens = chargedTokens(usage);
  const key = dayKey(model);

  try {
    await client.incrby(key, tokens);
    // Two days so a late write cannot land on a key that is about to expire
    // mid-window; the date in the key means old days are never read again.
    await client.expire(key, 172800);
  } catch (error) {
    console.warn(
      `[moderationBudget] could not record ${tokens} tokens for ${model}:`,
      error?.message,
    );
  }
};

/** Current spend for a model, or null when it cannot be determined. */
export const getBudgetStatus = async (model) => {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const spent = await readSpent(client, model);
    return { model, spent, limit: DAILY_BUDGET, margin: SAFETY_MARGIN };
  } catch (error) {
    console.error("[moderationBudget] status read failed:", error?.message);
    return null;
  }
};

export default {
  assertBudgetAvailable,
  recordSpend,
  getBudgetStatus,
  chargedTokens,
  ModerationBudgetError,
};
