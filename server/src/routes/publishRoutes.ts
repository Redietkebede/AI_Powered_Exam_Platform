// server/src/routes/publishRoutes.ts
import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import {
  approve,
  reject,
  setStatus,
  listPending,
  bulkPublish,
} from "../controllers/publishController";

const router = Router();

// Anyone with editor/admin/recruiter can list pending
router.get(
  "/pending",
  verifyToken,
  authorize(["editor", "admin", "recruiter"]),
  listPending
);

// Only editor/admin can change status
router.patch("/:id", verifyToken, authorize(["editor", "admin"]), setStatus);
router.post(
  "/:id/approve",
  verifyToken,
  authorize(["editor", "admin"]),
  approve
);
router.post("/:id/reject", verifyToken, authorize(["editor", "admin"]), reject);

router.post("/bulk", verifyToken, authorize(["editor", "admin"]), bulkPublish);
export default router;
