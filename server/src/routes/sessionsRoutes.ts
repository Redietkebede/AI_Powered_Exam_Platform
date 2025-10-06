// server/src/routes/sessionsRoutes.ts
import { Router } from "express";
import { verifyToken } from "../middleware/verifyToken";
import { getSessionTopic, submitSessionAnswers,getRemaining } from "../controllers/sessionsController";

const router = Router();

// ... other routes

router.get("/sessions/:id/topic", verifyToken, getSessionTopic);
router.post("/sessions/:id/submit", verifyToken, submitSessionAnswers);



export default router;
