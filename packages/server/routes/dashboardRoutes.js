import express from 'express';
import * as dashboardController from '../controllers/dashboardController.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();

router.get('/dashboard/stats', authorizePermission(PERMISSIONS.DASHBOARD_READ), dashboardController.getDashboardStats);
router.get('/dashboard/size-color-analytics', authorizePermission(PERMISSIONS.DASHBOARD_READ), dashboardController.getSizeColorAnalytics);

export default router;
