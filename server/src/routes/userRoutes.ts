import express from 'express';
import { verifyFirebaseToken } from '../middleware/verifyToken';
import { me } from '../controllers/meControllers';

const router = express.Router();

router.get('/me', verifyFirebaseToken, me);

export default router;
