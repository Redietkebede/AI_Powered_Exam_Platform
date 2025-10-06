import { Router } from "express";
import { getActivity } from "../controllers/activityController";
import { verifyToken } from "../middleware/verifyToken";

const router = Router();
router.get("/", verifyToken, getActivity);
export default router;
