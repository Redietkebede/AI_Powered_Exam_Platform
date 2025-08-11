import { Router } from "express";
import { createQuestions, listQuestions } from "../controllers/questionControllers";
import { verifyToken } from "../middleware/auth"; // your guard

const router = Router();
router.get('/ping', (_req, res) => res.json({ ok: true }));

router.get("/", verifyToken, listQuestions);

router.post("/generate", verifyToken, createQuestions);
export default router;
