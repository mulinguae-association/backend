/**
 * Groq API Service
 * Handles all communication with the Groq API for the chatbot feature.
 * This service is designed to be easily swappable if the LLM provider changes.
 */

import axios from "axios";
import { buildKnowledgeSystemPrompt } from "./knowledgeBase.js";

const groqApi = axios.create({
  baseURL: "https://api.groq.com/openai/v1",
  headers: {
    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  },
});

// Configurable model (defaults to one available on the Groq tier).
const DEFAULT_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

/**
 * Default system prompt for the chatbot.
 * This now includes the full website knowledge base so the AI can answer
 * questions about anything related to the platform.
 */
const DEFAULT_SYSTEM_PROMPT = buildKnowledgeSystemPrompt("general");

/**
 * Send a message to Groq and get a streaming response.
 *
 * @param {object} params - The parameters for the chat completion.
 * @param {Array} params.messages - The conversation messages (role/content pairs).
 * @param {string} [params.model] - The Groq model to use (default: "llama-3.3-70b-versatile").
 * @param {number} [params.temperature] - Sampling temperature (default: 0.7).
 * @param {number} [params.maxTokens] - Max tokens to generate (default: 1024).
 * @param {boolean} [params.stream] - Whether to stream the response (default: true).
 * @returns {Promise} Axios response with the chat completion.
 */
export const getGroqCompletion = async ({
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1024,
  stream = true,
}) => {
  const response = await groqApi.post(
    "/chat/completions",
    {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream,
    },
    { responseType: stream ? "stream" : "json" },
  );
  return response.data;
};

/**
 * Send a non-streaming completion request to Groq.
 * Useful for simpler queries or when streaming is not needed.
 *
 * @param {object} params - The parameters for the completion.
 * @param {Array} params.messages - The conversation messages.
 * @param {string} [params.model] - The Groq model to use.
 * @param {number} [params.temperature] - Sampling temperature.
 * @param {number} [params.maxTokens] - Max tokens to generate.
 * @returns {Promise} Axios response with the chat completion.
 */
export const getGroqCompletionSync = async ({
  messages,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1024,
}) => {
  const response = await groqApi.post("/chat/completions", {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  });
  return response.data;
};

/**
 * Build the message array for a conversation, adding the system prompt.
 *
 * @param {string} domain - The domain context (e.g., "general", "teachers").
 * @param {Array} conversationHistory - Array of previous messages.
 * @returns {Array} Complete message array including system prompt.
 */
export const buildGroqMessages = (domain, conversationHistory = []) => {
  const systemPrompt = {
    role: "system",
    content: getDomainSystemPrompt(domain),
  };
  return [systemPrompt, ...conversationHistory];
};

/**
 * Get the domain-specific system prompt.
 * @param {string} domain - The domain context.
 * @returns {string} The system prompt for the given domain.
 */
function getDomainSystemPrompt(domain) {
  // Use the knowledge-base-driven prompt for all domains, with domain context added.
  return buildKnowledgeSystemPrompt(domain);
}

export default {
  getGroqCompletion,
  getGroqCompletionSync,
  buildGroqMessages,
};
