import express from "express";
import { verifyToken } from "../middleware/verifyToken";
import {
  startExam,
  getNextQuestion,
  submitAnswer,
  submitExam,
  getMyAttempts,
  getMyCompletions,
  getSessionTopic,
  getMySessionsWithTopic,
  getSessionQuestions,
  getTopics,
  getAvailableCount,
} from "../controllers/examController";

const router = express.Router();
router.use(verifyToken);

router.post("/start", verifyToken, startExam);
router.post("/next", verifyToken, getNextQuestion);
router.post("/answer", verifyToken, submitAnswer);
router.post("/submit", verifyToken, submitExam);
router.get("/attempts/mine", getMyAttempts);
router.get("/completions/mine", getMyCompletions);
router.get("/sessions/:id/topic", getSessionTopic);
router.get("/sessions/mine", verifyToken, getMySessionsWithTopic);
router.get("/sessions/:id/questions", verifyToken, getSessionQuestions);

router.get("/questions/topics", verifyToken, getTopics);
router.get("/questions/available", verifyToken, getAvailableCount);

export default router;
