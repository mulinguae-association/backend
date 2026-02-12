// routes/ablyAuth.js
import express from "express";
import ablyAuth from "../controllers/ablyAuthController.js";

const router = express.Router();

router.get("/ably-auth", ablyAuth);

export default router;
