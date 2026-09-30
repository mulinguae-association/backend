import {
  purgeExpiredTombstones,
  TOMBSTONE_RETENTION_MONTHS,
} from "../services/comments/tombstoneCleanup.js";

// Scheduled maintenance, invoked by Vercel Cron rather than a timer: the
// backend is a serverless function, so there is no long-lived process for an
// interval to live in.
//
// Fails closed. If CRON_SECRET is absent in production the endpoint refuses to
// run rather than falling open, because an unauthenticated endpoint that can
// delete rows is not a risk worth taking for the convenience of a local
// dry run. In development, where no cron exists to call it, it runs open so the
// purge can be exercised by hand.
const isAuthorized = (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.get("authorization") || "";
  return header === `Bearer ${secret}`;
};

export async function purgeCommentTombstones(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: "A valid CRON_SECRET bearer token is required.",
    });
  }

  // Dry run by default. A maintenance endpoint reachable by a scheduler should
  // report what it would do before it does it; `?dryRun=false` is the explicit,
  // deliberate opt-in to the write.
  const dryRun = req.query.dryRun !== "false";

  try {
    const summary = await purgeExpiredTombstones({
      dryRun,
      log: (line) => console.log(line),
    });

    console.log(
      `[tombstones] ${dryRun ? "dry run" : "purged"}: ${summary.purged} of ${summary.scanned} expired tombstones older than ${TOMBSTONE_RETENTION_MONTHS} months`,
    );
    // Called out separately: these rows are never purged automatically, so a
    // non-zero count is a standing data problem, not a pending cleanup.
    if (summary.missingDeletedAt > 0) {
      console.warn(
        `[tombstones] ${summary.missingDeletedAt} deleted comment(s) have no usable deletedAt and were skipped; they need a manual fix`,
      );
    }

    return res.status(200).json(summary);
  } catch (error) {
    console.error("Error purging comment tombstones:", error);
    return res.status(500).json({
      error: "Internal server error",
      detail: "Tombstone cleanup failed; nothing else was touched.",
    });
  }
}
