// Purges tombstones older than the retention window, oldest first.
//
// Only a childless tombstone is deleted, and never a live row: the purge removes
// storage, it does not change what any reader can see. A tombstone under a live
// reply is retained, because deleting it would leave that reply with no parent to
// render under. Chains resolve leaf-first across as many passes as the chain is
// deep, since removing a child can make its own parent childless.
//
// A tombstone with no deletedAt is never a candidate: it has no age to judge, so
// it is counted (missingDeletedAt) and left for a human rather than guessed at.
import Comment from "../../db/models/Comment.js";
import { DELETED_COMMENT_STATUS } from "./deletionPolicy.js";

const RETENTION_MONTHS = 6;

// Calendar months, not 180 days: "six months old" should land on the same day
// every month, which a fixed day count does not.
export const TOMBSTONE_RETENTION_MONTHS = RETENTION_MONTHS;

export const retentionCutoff = (now = new Date(), months = RETENTION_MONTHS) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
};

export const purgeExpiredTombstones = async ({ now = new Date(), dryRun = true } = {}) => {
  const cutoff = retentionCutoff(now);
  const summary = {
    cutoff,
    retentionMonths: RETENTION_MONTHS,
    dryRun,
    passes: 0,
    scanned: 0,
    purged: 0,
    retainedWithChildren: 0,
    missingDeletedAt: 0,
    purgedIds: [],
  };
  const retained = new Set();

  // Tombstones with no usable deletedAt have no age to judge, so they are never
  // candidates and never auto-purged. $type is the reliable test here:
  // {deletedAt: {$exists: true, $ne: null}} does not exclude an explicit null
  // inside a range clause, which let null rows through as purge candidates.
  const missingDeletedAtFilter = {
    status: DELETED_COMMENT_STATUS,
    deletedAt: { $not: { $type: "date" } },
  };
  summary.missingDeletedAt = await Comment.countDocuments(missingDeletedAtFilter);

  // Each pass deletes a leaf layer, which can expose the layer above it, so the
  // loop repeats until a pass finds nothing new to remove. Terminates because
  // every iteration either deletes rows or returns.
  for (;;) {
    const pass = summary.passes;

    const candidates = await Comment.find({
      status: DELETED_COMMENT_STATUS,
      deletedAt: { $type: "date", $lt: cutoff },
    }).select("_id");

    if (candidates.length === 0) {
      summary.retainedWithChildren = retained.size;
      return summary;
    }
    summary.passes = pass + 1;
    summary.scanned += candidates.length;

    // distinct() so one id is never counted twice in a pass.
    const childParents = await Comment.distinct("parentComment", {
      parentComment: { $in: candidates.map((c) => c._id) },
    });
    const hasChildren = new Set(childParents.map(String));

    const purgable = [];
    for (const candidate of candidates) {
      const id = String(candidate._id);
      if (hasChildren.has(id)) {
        // Unique ids: a tombstone stays a candidate on later passes, so counting
        // per pass would multiply the same row by the depth of its chain.
        retained.add(id);
      } else {
        purgable.push(candidate._id);
      }
    }

    // A dry run reports what it would do and stops; it must not report progress
    // it did not make, or a run looks effective while changing nothing.
    if (dryRun || purgable.length === 0) {
      summary.retainedWithChildren = retained.size;
      summary.purged += purgable.length;
      summary.purgedIds.push(...purgable.map(String));
      return summary;
    }

    const result = await Comment.deleteMany({ _id: { $in: purgable } });
    summary.retainedWithChildren = retained.size;
    summary.purged += result.deletedCount ?? purgable.length;
    summary.purgedIds.push(...purgable.map(String));
  }
};
