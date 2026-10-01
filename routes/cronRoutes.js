// Maintenance endpoints. Not user-facing and not authenticated by
// authenticateUser: each route authorises itself with a CRON_SECRET bearer
// token, because a scheduler has no user session to present.
//
// The path carries the intent, so the scheduled job and a human cannot end up
// doing the same thing: the bare path reports, /purge deletes.
import express from "express";
import {
  purgeCommentTombstones,
  purgeCommentTombstonesNow,
} from "../controllers/cronController.js";

const router = express.Router();

router.get("/comment-tombstones", purgeCommentTombstones);
router.get("/comment-tombstones/purge", purgeCommentTombstonesNow);

export default router;
