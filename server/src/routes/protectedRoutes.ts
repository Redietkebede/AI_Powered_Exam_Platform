import { verifyFirebaseToken } from "../middleware/verifyToken";
import express from "express";

const router = express.Router();

// Only authenticated users can access this route
router.get('/dashboard', verifyFirebaseToken, (req, res) => {
  if (req.user) {
    res.send(`Welcome user with UID: ${req.user.uid}`);
  } else {
    res.status(401).send('Unauthorized');
  }
});

export default router;