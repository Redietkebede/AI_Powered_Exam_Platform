import express from 'express';
import { verifyFirebaseToken } from '../middleware/verifyToken';

const router = express.Router();

router.get('/profile', verifyFirebaseToken, (req, res) => {
  res.json({ message: 'Protected route!', uid: req.user?.uid });
});

export default router;
