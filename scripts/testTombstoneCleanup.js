// Scratch-DB tests for purgeExpiredTombstones.
//
// Requires SCRATCH_MONGO_URI pointing at a LOCAL mongod. The harness writes and
// deletes rows, so it refuses to start against anything remote rather than
// trusting the operator to have pointed it at a throwaway database.
//
//   mongod --dbpath <tmp> --port 27099 --bind_ip 127.0.0.1
//   SCRATCH_MONGO_URI=mongodb://127.0.0.1:27099/tombstone_scratch \
//     node scripts/testTombstoneCleanup.js
import mongoose from "mongoose";
import Comment from "../db/models/Comment.js";
import { purgeExpiredTombstones } from "../services/comments/tombstoneCleanup.js";

const URI = process.env.SCRATCH_MONGO_URI;
if (!URI) {
  console.error("SCRATCH_MONGO_URI is required");
  process.exit(1);
}
if (!/^(mongodb:\/\/)?(127\.0\.0\.1|localhost)/.test(URI)) {
  console.error(`Refusing to run: ${URI} is not a local mongod`);
  process.exit(1);
}

const DB_NAME = "tombstone_scratch";
const old = new Date("2020-01-01T00:00:00Z");
const recent = new Date();

let pass = 0;
let fail = 0;
const eq = (actual, expected, label) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const clear = () => Comment.deleteMany({});
const exists = (id) => Comment.exists({ _id: id });

// A tombstone unless told otherwise. The schema casts to Date, so an absent
// deletedAt and an explicit undefined both land as null: null is the one
// malformed shape that actually exists.
const mk = (parent, over = {}) => ({
  content: "",
  status: "deleted",
  deletedAt: old,
  updatedAt: old,
  postedBy: null,
  parentComment: parent ?? null,
  ...over,
});

const run = async (label, fn) => {
  console.log(`\n${label}`);
  await clear();
  await fn();
};

await mongoose.connect(URI, { dbName: DB_NAME });

// 1. A 12-level fully-deleted chain resolves completely in one run. Under the
// old MAX_PASSES=10 cap the top two levels survived and needed a second night.
await run("12-level fully-deleted chain collapses leaf-first in one run", async () => {
  const chain = [];
  let parent = null;
  for (let i = 0; i < 12; i += 1) {
    const doc = await Comment.create(mk(parent));
    chain.push(doc);
    parent = doc._id;
  }

  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.purged, 12, "purged all 12");
  eq(summary.passes, 12, "one pass per level");
  eq(summary.missingDeletedAt, 0, "no malformed rows");
  eq(await Comment.countDocuments({}), 0, "database empty");

  for (const doc of chain) {
    if (await exists(doc._id)) {
      fail += 1;
      console.log(`  FAIL ${doc._id} survived`);
    }
  }
});

// 2. Leaf-first ordering: the deepest node must go before its own parent, or a
// parent would be deleted while a reply still points at it.
await run("leaf-first order is preserved within a run", async () => {
  const chain = [];
  let parent = null;
  for (let i = 0; i < 5; i += 1) {
    const doc = await Comment.create(mk(parent));
    chain.push(doc);
    parent = doc._id;
  }

  const { purgedIds: order } = await purgeExpiredTombstones({ dryRun: false });

  for (let i = 0; i < chain.length - 1; i += 1) {
    const parentId = String(chain[i]._id);
    const childId = String(chain[i + 1]._id);
    if (order.indexOf(childId) > order.indexOf(parentId)) {
      fail += 1;
      console.log(`  FAIL parent ${parentId} purged before child ${childId}`);
    } else {
      pass += 1;
    }
  }
  console.log(`  ok   ${chain.length - 1} parent/child pairs ordered correctly`);
});

// 3. Descendant protection: a LIVE reply pins its tombstoned ancestors. R1 is
// childless, so it is legitimately purgeable; only P is pinned, by the live R2.
await run("live reply pins tombstoned ancestors", async () => {
  const p = await Comment.create(mk(null));
  const r1 = await Comment.create(mk(p._id));
  const r2 = await Comment.create(mk(p._id, { status: "accepted", deletedAt: null, content: "live" }));

  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.purged, 1, "only the childless R1 purged");
  eq(summary.retainedWithChildren, 1, "only P retained");
  eq(summary.passes, 2, "second pass leaves nothing purgable");

  eq(Boolean(await exists(p._id)), true, "tombstoned parent P survives, pinned by the live reply");
  eq(Boolean(await exists(r1._id)), false, "childless R1 purged");
  eq(Boolean(await exists(r2._id)), true, "live reply R2 survives");
});

// 4. A live row at the bottom of a deep chain retains every ancestor, and the
// run terminates instead of looping on the same candidates.
await run("a live row at the bottom retains every ancestor", async () => {
  const chain = [];
  let parent = null;
  for (let i = 0; i < 11; i += 1) {
    const doc = await Comment.create(mk(parent));
    chain.push(doc);
    parent = doc._id;
  }
  await Comment.create(mk(parent, { status: "accepted", deletedAt: null, content: "live" }));

  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.purged, 0, "nothing purged");
  eq(summary.retainedWithChildren, 11, "all 11 tombstones retained");
  eq(await Comment.countDocuments({ status: "deleted" }), 11, "all tombstones still present");
});

// 5. Malformed tombstones: no usable deletedAt means no age to judge. Counted,
// never purged, and they must not block valid candidates. The candidate filter
// previously admitted a null deletedAt inside a $lt range clause, which would
// have deleted the very rows this counter reports.
await run("tombstones with no deletedAt are counted but never purged", async () => {
  await Comment.create(mk(null, { deletedAt: null }));
  await Comment.create(mk(null, { deletedAt: undefined }));
  await Comment.create(mk(null, { deletedAt: null }));
  await Comment.create(mk(null));

  const admitted = await Comment.find({
    status: "deleted",
    deletedAt: { $type: "date", $lt: new Date("2021-01-01") },
  }).select("_id");
  eq(admitted.length, 1, "only the valid tombstone is a purge candidate");

  const malformed = await Comment.find({ status: "deleted", deletedAt: null }).select("_id");

  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.missingDeletedAt, 3, "three malformed rows counted");
  eq(summary.purged, 1, "the one valid tombstone purged");

  for (const row of malformed) {
    eq(Boolean(await exists(row._id)), true, "malformed row survives the purge");
  }
  eq(await Comment.countDocuments({}), 3, "only the malformed rows remain");
});

// 6. A malformed row with children is still only counted, never purged, and
// never counted as retained: it is not a candidate, so it never enters a pass.
await run("malformed tombstone with children is never purged", async () => {
  const parent = await Comment.create(mk(null, { deletedAt: null }));
  await Comment.create(mk(parent._id, { deletedAt: null }));

  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.missingDeletedAt, 2, "both malformed rows counted");
  eq(summary.purged, 0, "nothing purged");
  eq(summary.retainedWithChildren, 0, "not counted as retained-with-children either");
  eq(summary.passes, 0, "no candidate passes ran");
  eq(await Comment.countDocuments({}), 2, "both rows survive");
});

// 7. A recent tombstone is inside the retention window and must be untouched.
await run("tombstone inside the retention window is untouched", async () => {
  const fresh = await Comment.create(mk(null, { deletedAt: recent }));
  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.purged, 0, "nothing purged");
  eq(summary.missingDeletedAt, 0, "a present deletedAt is not malformed");
  eq(Boolean(await exists(fresh._id)), true, "recent tombstone survives");
});

// 8. Dry run reports the leaf layer without writing anything.
await run("dry run reports without writing", async () => {
  const chain = [];
  let parent = null;
  for (let i = 0; i < 3; i += 1) {
    const doc = await Comment.create(mk(parent));
    chain.push(doc);
    parent = doc._id;
  }

  const summary = await purgeExpiredTombstones({ dryRun: true });
  eq(summary.dryRun, true, "flagged as dry run");
  eq(summary.purged, 1, "only the leaf would go in a single pass");
  eq(await Comment.countDocuments({}), 3, "all three rows still present");
});

// 9. Two independent chains in one collection, plus an unrelated live comment.
await run("independent chains are both purged", async () => {
  const a = await Comment.create(mk(null));
  const a1 = await Comment.create(mk(a._id));
  const b = await Comment.create(mk(null));
  const b1 = await Comment.create(mk(b._id));
  await Comment.create(mk(null, { status: "accepted", deletedAt: null, content: "live" }));

  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.purged, 4, "four purged across both chains");
  eq(Boolean(await exists(a._id)), false, "chain A root gone");
  eq(Boolean(await exists(a1._id)), false, "chain A leaf gone");
  eq(Boolean(await exists(b._id)), false, "chain B root gone");
  eq(Boolean(await exists(b1._id)), false, "chain B leaf gone");
  eq(await Comment.countDocuments({}), 1, "only the live comment remains");
});

// 10. Re-running over an already-clean collection is a no-op.
await run("re-running over a clean collection is a no-op", async () => {
  const summary = await purgeExpiredTombstones({ dryRun: false });
  eq(summary.purged, 0, "nothing purged");
  eq(summary.passes, 0, "no passes needed");
});

await clear();
await mongoose.connection.dropDatabase();
await mongoose.disconnect();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
