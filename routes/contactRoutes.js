import express from "express";
import multer from "multer";
import { submitForm } from "../controllers/contactController.js";

const router = express.Router();


const upload = multer({ storage: multer.memoryStorage() });

router.post("/submit-info/:userType", upload.single('cv'), submitForm);

export default router