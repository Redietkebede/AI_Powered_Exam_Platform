// server/src/routes/auth.ts
import { Router } from "express";
import { verifyToken } from "../middleware/auth";

const router = Router();
router.get("/me", verifyToken, (req, res) => {
  const u = (req as any).user;
  console.log("[/auth/me] return", u);
  res.json(u);
});
export default router;


