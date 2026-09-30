// Maintenance endpoints. Not user-facing and not authenticated by
// authenticateUser: each route authorises itself with a CRON_SECRET bearer
// token, because a scheduler has no user session to present.
import express from "express";
import { purgeCommentTombstones } from "../controllers/cronController.js";

const router = express.Router();

router.get("/comment-tombstones", purgeCommentTombstones);

export default router;
