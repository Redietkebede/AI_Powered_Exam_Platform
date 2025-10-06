// server/src/routes/analyticsRoutes.ts
import { Router } from "express";
import { getOverview } from "../controllers/analyticsController";

const router = Router();

// Main overview endpoint used by the FE
router.get("/analytics/overview", getOverview);

export default router;
