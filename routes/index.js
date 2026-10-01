// routes/index.js
import teacherCardRoutes from './teacherCardRoutes.js';
import blogPostRoutes from "./blogPostRoutes.js"
import blogsComments from "./commentsRouter.js"
import contactRoutes from "./contactRoutes.js"
import authRoute from './authRoutes.js'
import FAQs from './FAQ.js';
import userRoutes from './userRoutes.js';
import express from 'express';
import chatbotRoutes from './chatbotRoutes.js';
import cronRoutes from './cronRoutes.js';

const router = express.Router();

router.use('/', teacherCardRoutes);
router.use("/blogPosts", blogPostRoutes);
router.use("/comments", blogsComments);
router.use("/auth", authRoute);
router.use("/users", userRoutes);
router.use("/", FAQs);
router.use("/", contactRoutes);
router.use("/chatbot", chatbotRoutes);
router.use("/cron", cronRoutes);


export default router;
