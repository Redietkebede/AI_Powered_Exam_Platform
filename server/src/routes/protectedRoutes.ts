import { verifyToken } from "../middleware/verifyToken";
import express from "express";
import { AuthRequest } from "../types/AuthRequest";

const router = express.Router();

// Only authenticated users can access this route
router.get('/dashboard', verifyToken, (req: AuthRequest, res) => {
  if (req.user) {
    res.send(`Welcome user with UID: ${req.user.uid}`);
  } else {
    res.status(401).send('Unauthorized');
  }
});

export default router;