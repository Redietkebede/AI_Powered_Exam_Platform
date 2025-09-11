import express from "express";
import { verifyToken } from "../middleware/verifyToken";
import { authorize } from "../middleware/authorize"; // if you have it
import { listAssignments, createAssignment } from "../controllers/assignmentController";

const router = express.Router();
router.use(verifyToken);

router.get("/assignments", authorize(["recruiter","admin"]), listAssignments);
router.post("/assignments", authorize(["recruiter","admin"]), createAssignment);

export default router;
