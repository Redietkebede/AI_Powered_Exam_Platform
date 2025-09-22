import { Router } from "express";
import { verifyToken } from "../middleware/auth"; // your strict auth.ts
import { authorize } from "../middleware/authorize";
import {
  createQuestions,
  listQuestions,
  deleteQuestion,
  createQuestionManual,
  deleteQuestionById,
  listPublishedQuestions,
  listTopicsWithCounts,
  countAvailableForTopic,
} from "../controllers/questionControllers";

const router = Router();

/* --------------------- READ (published list) --------------------- */
// FE uses this on Assignment → Configuration step
router.get(
  "/questions/published",
  verifyToken,
  authorize(["admin", "editor", "recruiter", "candidate"]), // allow recruiter to configure exams
  listPublishedQuestions
);

/* --------------------- Topics + counts (published only) --------------------- */
// FE calls this to show topic chips
router.get(
  "/questions/topics",
  verifyToken,
  authorize(["admin", "editor", "recruiter", "candidate"]), // candidate can see topics
  listTopicsWithCounts
);

// FE calls this to show "Available questions" for a topic
router.get(
  "/questions/available",
  verifyToken,
  authorize(["admin", "editor", "recruiter", "candidate"]), // candidate can see count
  countAvailableForTopic
);

router.get(
  "/questions",
  verifyToken,
  authorize(["admin", "editor", "recruiter"]),
  listQuestions
);

router.get(
  "/questions/published",
  verifyToken,
  authorize(["admin", "editor", "recruiter", "candidate"]),
  listPublishedQuestions
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
