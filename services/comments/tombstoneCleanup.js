// Purges tombstones older than the retention window, oldest first.
//
// Only a childless tombstone is deleted, and never a live row: the purge removes
// storage, it does not change what any reader can see. A tombstone under a live
// reply is retained, because deleting it would leave that reply with no parent to
// render under. Chains resolve across passes, since removing a child can make
// its own parent childless.
import Comment from "../../db/models/Comment.js";
import { DELETED_COMMENT_STATUS } from "./deletionPolicy.js";

const RETENTION_MONTHS = 6;
const MAX_PASSES = 10;

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
    purgedIds: [],
  };

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const candidates = await Comment.find({
      status: DELETED_COMMENT_STATUS,
      deletedAt: { $lt: cutoff },
    }).select("_id");

    if (candidates.length === 0) {
      summary.passes = pass;
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
        summary.retainedWithChildren += 1;
      } else {
        purgable.push(candidate._id);
      }
    }

    // A dry run reports what it would do and stops; it must not report progress
    // it did not make, or a run looks effective while changing nothing.
    if (dryRun || purgable.length === 0) {
      summary.purged += purgable.length;
      summary.purgedIds.push(...purgable.map(String));
      summary.passes = pass + 1;
      return summary;
    }

    const result = await Comment.deleteMany({ _id: { $in: purgable } });
    summary.purged += result.deletedCount ?? purgable.length;
    summary.purgedIds.push(...purgable.map(String));
  }

  return summary;
};
