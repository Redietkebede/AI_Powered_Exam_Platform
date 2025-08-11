import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import * as Exams from '../controllers/examController';

const router = express.Router();

router.post('/start', verifyToken, Exams.startExam);
router.post('/next', verifyToken, Exams.getNextQuestion);
router.post('/answer', verifyToken, Exams.submitAnswer);
router.post('/submit', verifyToken, Exams.submitExam);

export default router;
