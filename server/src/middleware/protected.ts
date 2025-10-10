import express from 'express';
import { verifyToken } from '../middleware/verifyToken';

const router = express.Router();

router.get('/profile', verifyToken, (req, res) => {
  res.json({ message: 'Protected route!', uid: req.user?.uid });
});

export default router;
