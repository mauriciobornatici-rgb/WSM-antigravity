import express from 'express';
import * as dashboardController from '../controllers/dashboardController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/dashboard/stats', authenticateToken, dashboardController.getDashboardStats);

export default router;
