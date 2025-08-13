import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import * as Exams from '../controllers/examController';

const router = express.Router();
router.use(verifyToken);

router.post('/start', Exams.startExam);
router.post('/next', Exams.getNextQuestion);
router.post('/answer', Exams.submitAnswer);
router.post('/submit', Exams.submitExam);

export default router;
