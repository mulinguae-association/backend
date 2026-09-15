import mongoose from "mongoose";

const knowledgeEmbeddingSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
  },
  source: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    default: "general",
  },
  embedding: {
    type: [Number],
    required: true,
  },
  chunkIndex: {
    type: Number,
    default: 0,
  },
});

const KnowledgeEmbedding = mongoose.model(
  "KnowledgeEmbedding",
  knowledgeEmbeddingSchema,
);

export default KnowledgeEmbedding;
