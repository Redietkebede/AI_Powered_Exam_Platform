import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import { attachUserRole } from '../middleware/roles';
import { me } from '../controllers/meControllers';
import { startExam } from '../controllers/examController';

const router = express.Router();
router.get('/', verifyToken, attachUserRole, me);
router.post('/start', verifyToken, startExam);

export default router;
