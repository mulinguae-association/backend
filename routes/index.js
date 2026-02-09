// routes/index.js

import teacherCardRoutes from "./teacherCardRoutes.js";
import blogPostRoutes from "./blogPostRoutes.js";
import blogsComments from "./commentsRouter.js";
import contactRoutes from "./contactRoutes.js";
import authRoute from "./authRoutes.js";
import FAQs from "./FAQ.js";
import notificationRoutes from "./notificationRoutes.js";
import userRoutes from "./userRoutes.js";
import express from "express";

const router = express.Router();

router.use("/", teacherCardRoutes);
router.use("/blogPosts", blogPostRoutes);
router.use("/comments", blogsComments);
router.use("/auth", authRoute);
router.use("/notifications", notificationRoutes);
router.use("/", FAQs);
router.use("/", contactRoutes);
// Admin user management
router.use("/users", userRoutes);

export default router;
