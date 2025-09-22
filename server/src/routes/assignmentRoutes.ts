import express from "express";
import { verifyToken } from "../middleware/verifyToken";
import { authorize } from "../middleware/authorize"; // if you have it
import {
  listAssignments,
  createAssignment,
  createSessionForCandidate,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  listMyAssignments,
} from "../controllers/assignmentController";

const router = express.Router();
router.use(verifyToken);

router.post(
  "/assignments/create-session",
  authorize(["recruiter"]),
  createSessionForCandidate
);

router.get("/assignments", authorize(["recruiter", "admin"]), listAssignments);

router.post(
  "/assignments",
  authorize(["recruiter", "admin"]),
  createAssignment
);
// candidate-safe (NO role gate)
router.get(
  "/assignments/mine",
  verifyToken,
  authorize(["candidate"]),
  listMyAssignments // SELECT * FROM exam_sessions WHERE user_id = req.user.id AND finished_at IS NULL
);

// MUST be after /mine
router.get("/assignments/:id", verifyToken, getAssignmentById);
router.patch(
  "/assignments/:id",
  verifyToken,
  authorize(["admin", "editor", "recruiter"]),
  updateAssignment
);
router.delete(
  "/assignments/:id",
  verifyToken,
  authorize(["admin", "editor", "recruiter"]),
  deleteAssignment
);
export default router;
