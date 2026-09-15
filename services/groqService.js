/**
 * Groq API Service
 * Handles all communication with the Groq API for the chatbot feature.
 * This service is designed to be easily swappable if the LLM provider changes.
 *
 * Includes exponential backoff retry for transient 429/5xx errors.
 * Uses RAG (Retrieval-Augmented Generation) via vector search when available,
 * falling back to the full knowledge base prompt otherwise.
 * RAG context and responses are cached in Redis to avoid redundant work.
 */

import axios from "axios";
import { buildKnowledgeSystemPrompt } from "./knowledgeBase.js";
import { retrieveContext } from "./vectorSearchService.js";
import { getCachedRagContext, cacheRagContext } from "./chatCacheService.js";

/**
 * Get the Groq chat client (lazy init).
 * Reads GROQ_API_KEY at call time, not module load time.
 */
let _groqApi = null;
const getGroqClient = () => {
  if (!_groqApi) {
    _groqApi = axios.create({
      baseURL: "https://api.groq.com/openai/v1",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
  }
  return _groqApi;
};

// Configurable model (defaults to one available on the Groq tier).
// NOTE: Llama models are Enterprise-only now; gpt-oss-120b is on the dev plan.
const DEFAULT_MODEL = "openai/gpt-oss-120b";

/** Retry configuration for transient 429 rate-limit and 5xx server errors. */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const withRetry = async (fn, retries = MAX_RETRIES, delay = BASE_DELAY_MS) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (isRetryable && attempt < retries - 1) {
        console.warn(
          `[groqService] ${status} error. Retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
        continue;
      }

      // Drain the (often streamed) error body so the real API message surfaces.
      const { statusText, data } = error.response || {};
      let body = data;
      if (data && typeof data.pipe === "function") {
        body = await new Promise((resolve) => {
          const chunks = [];
          data.on("data", (chunk) => chunks.push(chunk));
          data.on("end", () => resolve(Buffer.concat(chunks).toString()));
          data.on("error", () => resolve("[unreadable stream body]"));
        });
      } else if (typeof data === "object") {
        body = JSON.stringify(data);
      }
      console.error("[groqService] Request failed:", status, statusText, body);
      throw error;
    }
  }
};

/**
 * Send a message to Groq and get a (streaming) chat completion.
 * Retries on transient 429/5xx errors with exponential backoff.
 * @returns {Promise} Axios response with the chat completion.
 */
export const getGroqCompletion = async ({
  messages,
  model = process.env.GROQ_MODEL || DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1024,
  stream = true,
}) => {
  console.log(
    `[groqService] Calling Groq — model=${model}, stream=${stream}, messages=${messages.length}`,
  );
  const response = await withRetry(() =>
    getGroqClient().post(
      "/chat/completions",
      { model, messages, temperature, max_tokens: maxTokens, stream },
      { responseType: stream ? "stream" : "json" },
    ),
  );
  return response.data;
};

/**
 * Build the message array for a conversation, adding the system prompt.
 * When vector search is available, uses RAG to retrieve only the top relevant
 * knowledge chunks (~1-2 KB) instead of the full knowledge base (~13 KB).
 *
 * @param {string} domain - The domain context (e.g., "general", "teachers").
 * @param {Array} conversationHistory - Array of previous messages.
 * @param {string} [userQuery] - The latest user message (for RAG retrieval).
 * @returns {Array} Complete message array including system prompt.
 */
export const buildGroqMessages = async (
  domain,
  conversationHistory = [],
  userQuery = "",
) => {
  const systemContent = userQuery
    ? await getRagSystemPrompt(domain, userQuery)
    : buildKnowledgeSystemPrompt(domain);

  return [{ role: "system", content: systemContent }, ...conversationHistory];
};

/**
 * Build a RAG-enhanced system prompt: retrieve only the most relevant knowledge
 * chunks for the user's question, keeping the prompt payload small.
 * Falls back to the full prompt if vector search is unavailable.
 * The retrieved context is cached in Redis to skip embedding + search on repeats.
 *
 * @param {string} domain - The domain context.
 * @param {string} userQuery - The user's question to retrieve context for.
 * @returns {string} The RAG system prompt.
 */
async function getRagSystemPrompt(domain, userQuery) {
  try {
    let ragContext = await getCachedRagContext(userQuery, domain);
    if (!ragContext) {
      ragContext = await retrieveContext(userQuery, { domain, topK: 3 });
      if (ragContext) await cacheRagContext(userQuery, domain, ragContext);
    }

    if (ragContext) {
      console.log(
        `[groqService] RAG context ready: ${ragContext.length} chars`,
      );
      const domainNote =
        domain === "teachers"
          ? "\n\nYou are currently specialized in teacher profiles and education."
          : "";

      return `You are Mulinguae's AI assistant. Help users with questions about the Mulinguae platform, language learning, courses, teachers, and community features. Be helpful, friendly, concise, and informative.

Use the following context to answer the user's question. Always base your answers on this context and never claim a feature exists when it is marked as not implemented. If a question is outside this scope, politely say you can help with topics related to Mulinguae and its language-learning features, and direct them to the relevant page.${domainNote}

<context>
${ragContext}
</context>`;
    }
  } catch (err) {
    console.warn(
      "RAG retrieval failed, falling back to full prompt:",
      err.message,
    );
  }
  // Fallback: use the full knowledge base
  return buildKnowledgeSystemPrompt(domain);
}

export default {
  getGroqCompletion,
  buildGroqMessages,
};
