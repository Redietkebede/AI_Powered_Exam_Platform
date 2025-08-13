import { Router } from "express";
import { verifyToken } from "../middleware/auth";      // your strict auth.ts
import { authorize, atLeast } from "../middleware/authorize";
import { createQuestions, listQuestions, deleteQuestion,publishQuestion } from "../controllers/questionControllers";

const router = Router();

// Only admin/editor can generate questions
router.post(
  "/api/questions/generate",
  verifyToken,
  authorize(["admin", "editor"]),
  createQuestions
);

// Admin/editor/recruiter can list questions
router.get(
  "/api/questions",
  verifyToken,
  authorize(["admin", "editor", "recruiter"]),
  listQuestions
);

// Admin only can delete a question
router.delete(
  "/api/questions/:id",
  verifyToken,
  authorize(["admin"]),
  deleteQuestion
);

// Example using hierarchy helper:
router.post(
  "/api/publish",
  verifyToken,
  atLeast("editor"), // editor or admin
  publishQuestion
);

export default router;
