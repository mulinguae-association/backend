/**
 * Website Crawler Script
 * Automatically crawls the Mulinguae website and indexes content into MongoDB.
 *
 * Combines:
 * 1. Static knowledge base (knowledgeBase.js) — platform features, pages, FAQs
 * 2. Dynamic API data — teachers, blog posts, courses
 *
 * Run: npm run crawl-website
 * Or call crawlAndIndex() from code.
 *
 * This replaces manual editing of knowledgeBase.js for dynamic content.
 * Static content (pages, features, FAQs) still lives in knowledgeBase.js.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import axios from "axios";
import KnowledgeEmbedding from "../db/models/KnowledgeEmbedding.js";
import { WEBSITE_KNOWLEDGE } from "../services/knowledgeBase.js";
import { embedText } from "../services/vectorSearchService.js";

const configuredBackendUrl = process.env.BACKEND_URL || "http://localhost:5000";
const normalizedBackendUrl = configuredBackendUrl.replace(/\/$/, "");
const API_BASE = normalizedBackendUrl.endsWith("/api")
  ? normalizedBackendUrl
  : `${normalizedBackendUrl}/api`;

// --- API Crawlers -----------------------------------------------------------

/**
 * Fetch all accepted blog posts and format as knowledge chunks.
 */
const crawlBlogPosts = async () => {
  try {
    const { data } = await axios.get(`${API_BASE}/blogPosts/accepted`);
    const posts = data.posts || data || [];

    return posts.map((post) => ({
      content: `## BLOG: ${post.title}
${post.subtitle ? post.subtitle + "\n" : ""}
${post.content?.replace(/<[^>]*>/g, "").trim() || "No content available."}
Author: ${post.author?.name || "Unknown"} | Date: ${new Date(post.createdAt).toLocaleDateString()}`,
      source: `Blog: ${post.title}`,
      category: "community",
    }));
  } catch (err) {
    console.warn("  Failed to crawl blog posts:", err.message);
    return [];
  }
};

/**
 * Fetch teacher cards and format as knowledge chunks.
 */
const crawlTeachers = async () => {
  try {
    const { data } = await axios.get(`${API_BASE}/teachers`);
    const teachers = data.teachers || data || [];

    return teachers.map((t) => ({
      content: `## TEACHER: ${t.firstName} ${t.lastName}
${t.about ? "About: " + t.about : ""}
${t.jobBrief ? "Specialization: " + t.jobBrief : ""}
${t.teachingMethods ? "Teaching Methods: " + t.teachingMethods : ""}
${t.qualifications ? "Qualifications: " + t.qualifications : ""}`.trim(),
      source: `Teacher: ${t.firstName} ${t.lastName}`,
      category: "teachers",
    }));
  } catch (err) {
    console.warn("  Failed to crawl teachers:", err.message);
    return [];
  }
};

// --- Chunking ---------------------------------------------------------------

const MAX_CHUNK_CHARS = 1500;

const chunkSection = (text, source, category) => {
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

// --- Main Crawler -----------------------------------------------------------

/**
 * Crawl the website and index everything into MongoDB.
 * @returns {Promise<{indexed: number, sources: string[]}>}
 */
export const crawlAndIndex = async () => {
  console.log("Starting website crawl...\n");

  // 1. Static knowledge base
  const staticChunks = [];
  for (const section of WEBSITE_KNOWLEDGE) {
    const firstLine = section.split("\n")[0];
    const source = firstLine.replace(/^#+\s*/, "").trim();
    const category = source.toLowerCase().includes("teacher")
      ? "teachers"
      : source.toLowerCase().includes("course") ||
          source.toLowerCase().includes("level")
        ? "courses"
        : "general";
    staticChunks.push(...chunkSection(section, source, category));
  }
  console.log(`  Static knowledge base: ${staticChunks.length} chunks`);

  // 2. Dynamic: blog posts
  console.log("  Crawling blog posts...");
  const blogChunks = await crawlBlogPosts();
  console.log(`  Blog posts: ${blogChunks.length} chunks`);

  // 3. Dynamic: teachers
  console.log("  Crawling teachers...");
  const teacherChunks = await crawlTeachers();
  console.log(`  Teachers: ${teacherChunks.length} chunks`);

  // Combine all
  const allChunks = [...staticChunks, ...blogChunks, ...teacherChunks];

  // Clear and re-insert
  await KnowledgeEmbedding.deleteMany({});

  if (allChunks.length === 0) {
    console.log("\nNo content to index.");
    return { indexed: 0, sources: [] };
  }

  const docs = [];
  for (const [idx, chunk] of allChunks.entries()) {
    const embedding = await embedText(chunk.content);
    if (embedding) {
      docs.push({ ...chunk, embedding, chunkIndex: idx });
    }
  }

  if (docs.length > 0) await KnowledgeEmbedding.insertMany(docs);

  const sources = [...new Set(allChunks.map((c) => c.source))];
  console.log(
    `\nIndexed ${docs.length} chunks from ${sources.length} sources.`,
  );
  return { indexed: docs.length, sources };
};

// --- CLI Entry Point --------------------------------------------------------

// When run directly via `npm run crawl-website`
const isMain = process.argv[1]?.endsWith("crawlWebsite.js");
if (isMain) {
  const { connectToDatabase } = await import("../db/db.js");
  await connectToDatabase();
  const result = await crawlAndIndex();
  process.exit(0);
}

export default { crawlAndIndex };
