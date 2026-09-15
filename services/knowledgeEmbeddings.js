import KnowledgeEmbedding from "../db/models/KnowledgeEmbedding.js";
import { WEBSITE_KNOWLEDGE } from "./knowledgeBase.js";
import { embedText } from "./vectorSearchService.js";

const MAX_CHUNK_CHARS = 1500;

const chunkSection = (text, source) => {
  const category = categorizeSource(source);

  if (text.length <= MAX_CHUNK_CHARS) {
    return [{ content: text.trim(), source, category }];
  }

  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  let buffer = "";

  for (const para of paragraphs) {
    if (buffer.length + para.length > MAX_CHUNK_CHARS && buffer) {
      chunks.push({ content: buffer.trim(), source, category });
      buffer = "";
    }
    buffer += (buffer ? "\n\n" : "") + para;
  }
  if (buffer.trim()) {
    chunks.push({ content: buffer.trim(), source, category });
  }
  return chunks;
};

const categorizeSource = (source) => {
  const s = source.toLowerCase();
  if (s.includes("teacher")) return "teachers";
  if (s.includes("course") || s.includes("level")) return "courses";
  if (s.includes("blog") || s.includes("community")) return "community";
  if (s.includes("account") || s.includes("auth")) return "getting-started";
  if (s.includes("technical")) return "technical";
  return "general";
};

export const indexKnowledgeBase = async () => {
  await KnowledgeEmbedding.deleteMany({});

  const allChunks = [];
  for (const section of WEBSITE_KNOWLEDGE) {
    const firstLine = section.split("\n")[0];
    const source = firstLine.replace(/^#+\s*/, "").trim();
    allChunks.push(...chunkSection(section, source));
  }

  if (allChunks.length === 0) {
    return { indexed: 0, chunks: 0 };
  }

  const docs = [];
  for (const [idx, chunk] of allChunks.entries()) {
    const embedding = await embedText(chunk.content);
    if (embedding) {
      docs.push({ ...chunk, embedding, chunkIndex: idx });
    }
  }

  if (docs.length > 0) await KnowledgeEmbedding.insertMany(docs);
  console.log(`Knowledge base indexed: ${docs.length} chunks`);
  return { indexed: docs.length, chunks: docs.length };
};

export const getEmbeddingCount = async () => {
  return KnowledgeEmbedding.countDocuments();
};

export default { indexKnowledgeBase, getEmbeddingCount };
