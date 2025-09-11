import { Router } from "express";
import { verifyToken } from "../middleware/verifyToken";
import { verifyFirebaseOnly } from "../middleware/verifyFirebaseOnly";
import {
  me,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/usersControllers";

const router = Router();

// Auth bootstrap — works even for first-time logins
// Final URL: GET /api/auth/me
router.get("/auth/me", verifyFirebaseOnly, me);

// Admin users management
// Final URLs: /api/users, /api/users/:id
router.get("/users", verifyToken, listUsers);           // verifyToken: requires DB + role checks in your authorize()
router.post("/users", verifyToken, createUser);
router.patch("/users/:id", verifyToken, updateUser);
router.delete("/users/:id", verifyToken, deleteUser);

export default router;
