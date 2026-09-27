/**
 * CLI script: report how the accepted-posts feed query is executed, and
 * optionally build the indexes that query needs.
 * Run with: npm run inspect-blog-index            (read-only, safe any time)
 *           npm run inspect-blog-index -- --build (writes: creates indexes)
 *
 * Requires MONGO_URI in .env.
 *
 * Without --build this only reads: it prints the indexes the collection already
 * has and the executionStats for the feed query, so COLLSCAN and docsExamined can
 * be compared before and after a build. Nothing is written without the flag.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { connectToDatabase } from "../db/db.js";
import BlogPost from "../db/models/BlogPost.js";

const BUILD = process.argv.includes("--build");

// Mirrors getAcceptedBlogPosts so the plan reflects the query that actually runs.
const feedQuery = (extra = {}) =>
  BlogPost.find({ status: "accepted", ...extra })
    .sort({ createdAt: -1, _id: -1 })
    .limit(6)
    .populate({
      path: "postedBy",
      model: "User",
      select: "_id name profileImage role",
    })
    .lean();

const report = async (label, extra = {}) => {
  const stats = await feedQuery(extra).explain("executionStats");
  const es = stats.executionStats || {};
  const winning = stats.queryPlanner?.winningPlan || {};
  const stage = winning.winningPlan?.inputStage || {};
  console.log(`\n[${label}]`);
  console.log(`  stage            ${stage.stage || "(none)"}`);
  console.log(`  docsExamined     ${es.totalDocsExamined ?? "n/a"}`);
  console.log(`  keysExamined     ${es.totalKeysExamined ?? "n/a"}`);
  console.log(`  nReturned        ${es.nReturned ?? "n/a"}`);
  console.log(`  executionTimeMs  ${es.executionTimeMillis ?? "n/a"}`);
};

const main = async () => {
  console.log("Connecting to MongoDB...");
  await connectToDatabase();

  const existing = await BlogPost.collection.indexes();
  console.log(`\nIndexes on blogposts (${existing.length}):`);
  for (const ix of existing) {
    console.log(`  ${ix.name}  ${JSON.stringify(ix.key)}`);
  }

  const total = await BlogPost.countDocuments({ status: "accepted" });
  console.log(`\nAccepted posts: ${total}`);

  if (BUILD) {
    console.log("\n--build given: creating the schema-declared indexes...");
    const wanted = BlogPost.schema.indexes();
    for (const [fields, opts] of wanted) {
      const name = await BlogPost.collection.createIndex(fields, opts);
      console.log(`  built ${name}`);
    }
  } else {
    console.log(
      "\nRead-only run. Re-run with -- --build to create the missing indexes.",
    );
  }

  await report("unfiltered feed");
  await report("category feed", { category: "general" });

  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
