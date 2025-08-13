import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import { me } from '../controllers/meControllers';

const router = express.Router();

router.get('/me', verifyToken, me);

export default router;
