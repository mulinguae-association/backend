import { pipeline } from "@huggingface/transformers";
import mongoose from "mongoose";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const COLLECTION = "knowledgeembeddings";
const INDEX_NAME = "knowledge_embeddings";

let _extractor = null;

const getExtractor = async () => {
  if (!_extractor) {
    _extractor = await pipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    });
  }
  return _extractor;
};

/**
 * Embed query text locally (single short string — fast even on cold start).
 */
export const embedText = async (text) => {
  try {
    const extractor = await getExtractor();
    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data);
  } catch (err) {
    console.warn("[vectorSearch] Embedding failed:", err.message);
    return null;
  }
};

/**
 * Retrieve the top-K most relevant knowledge chunks via Atlas Vector Search.
 */
export const retrieveContext = async (
  query,
  { domain = "general", topK = 3 } = {},
) => {
  const embedding = await embedText(query);
  if (!embedding) return null;

  const db = mongoose.connection.db;
  if (!db) return null;

  const collection = db.collection(COLLECTION);

  const pipeline = [
    {
      $vectorSearch: {
        index: INDEX_NAME,
        path: "embedding",
        queryVector: embedding,
        numCandidates: topK * 10,
        limit: topK,
        ...(domain !== "general" && {
          filter: {
            category: { $in: [domain, "general"] },
          },
        }),
      },
    },
  ];

  pipeline.push({
    $project: {
      content: 1,
      source: 1,
      category: 1,
      _score: { $meta: "vectorSearchScore" },
    },
  });

  try {
    const results = await collection.aggregate(pipeline).toArray();
    if (!results || results.length === 0) return null;

    return results
      .map((r) => `[Source: ${r.source}]\n${r.content}`)
      .join("\n\n---\n\n");
  } catch (err) {
    console.warn("[vectorSearch] Query failed:", err.message);
    return null;
  }
};

export default { embedText, retrieveContext };
