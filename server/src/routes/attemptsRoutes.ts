import { Router } from "express";
import { verifyToken } from "../middleware/verifyToken";
import { authorize } from "../middleware/authorize";
import {
  listMyAttempts,
  attemptSummary,
  getAttemptItems,       // ← add this (see §2)
} from "../controllers/attemptsController";

const r = Router();

r.get("/attempts/mine", verifyToken, authorize(["candidate"]), listMyAttempts);
r.get("/attempts/:attemptId/summary", verifyToken, authorize(["candidate"]), attemptSummary);
r.get("/attempts/:attemptId/items", verifyToken, authorize(["candidate"]), getAttemptItems); // ← add

export default r;
