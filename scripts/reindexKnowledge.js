/**
 * CLI script: reindex knowledge base embeddings.
 * Run with: npm run reindex-knowledge
 *
 * Requires GROQ_API_KEY and MONGO_URI in .env.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { connectToDatabase } from "../db/db.js";
import {
  indexKnowledgeBase,
  getEmbeddingCount,
} from "../services/knowledgeEmbeddings.js";
import {
  invalidateChatCache,
  invalidateRagCache,
} from "../services/chatCacheService.js";

const main = async () => {
  console.log("Connecting to MongoDB...");
  await connectToDatabase();

  console.log("Indexing knowledge base embeddings...");
  const result = await indexKnowledgeBase();
  console.log(
    `Done — ${result.indexed} chunks indexed (${result.chunks} total).`,
  );

  console.log("Invalidating chat + RAG caches (knowledge base changed)...");
  const [cleared, clearedRag] = await Promise.all([
    invalidateChatCache(),
    invalidateRagCache(),
  ]);
  console.log(
    `Cache cleared: ${cleared} responses + ${clearedRag} RAG contexts removed.`,
  );

  const total = await getEmbeddingCount();
  console.log(`Total embeddings in DB: ${total}`);

  process.exit(0);
};

main().catch((err) => {
  console.error("Reindex failed:", err);
  process.exit(1);
});
