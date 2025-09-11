import { Router } from "express";
import { verifyToken } from "../middleware/auth"; // your strict auth.ts
import { authorize } from "../middleware/authorize";
import {
  createQuestions,
  listQuestions,
  deleteQuestion,
  createQuestionManual,
  deleteQuestionById
} from "../controllers/questionControllers";

const router = Router();


router.get(
  "/questions",
  verifyToken,
  authorize(["admin", "editor", "recruiter"]),
  listQuestions
);

router.post(
  "/questions",
  verifyToken,
  authorize(["editor", "admin"]),
  createQuestionManual
);
router.post(
  "/questions/generate",
  verifyToken,
  authorize(["editor"]),
  createQuestions
);

router.delete(
  "/questions/:id",
  verifyToken,
  authorize(["admin", "editor"]),
  deleteQuestionById
);

export default router;
