import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import { restrictTo } from '../middleware/roles';
import * as Questions from '../controllers/questionControllers';

const router = express.Router();

router.post('/', verifyToken, restrictTo('admin','editor'), Questions.create);
router.get('/', verifyToken, restrictTo('admin','editor'), Questions.list);

export default router;
