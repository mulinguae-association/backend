import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import mongoose from "mongoose";
import { connectToDatabase } from "../db/db.js";
import { pipeline } from "@huggingface/transformers";

await connectToDatabase();
const db = mongoose.connection.db;

// Generate real embedding for query
const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
const output = await extractor("How do I book a lesson?", { pooling: "mean", normalize: true });
const queryVector = Array.from(output.data);

// Check stored embeddings
const sample = await db.collection("knowledgeembeddings").findOne();

// Test pipeline with real query vector
const results = await db.collection("knowledgeembeddings").aggregate([
  {
    $vectorSearch: {
      index: "knowledge_embeddings",
      path: "embedding",
      queryVector: queryVector,
      numCandidates: 12,
      limit: 3,
    },
  },
]).toArray();

// Test with dummy vector (baseline)
const dummyResults = await db.collection("knowledgeembeddings").aggregate([
  {
    $vectorSearch: {
      index: "knowledge_embeddings",
      path: "embedding",
      queryVector: new Array(384).fill(0.1),
      numCandidates: 12,
      limit: 3,
    },
  },
]).toArray();

// Summary
console.log(
  `Query dims: ${queryVector.length} | Stored dims: ${sample.embedding.length} | Real results: ${results.length} | Dummy results: ${dummyResults.length}`
);

process.exit(0);
