import express from 'express';
import * as traceabilityController from '../controllers/traceabilityController.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const traceabilityReadRoles = authorizeRoles('admin', 'manager', 'warehouse', 'cashier');

router.get('/traceability/timeline', traceabilityReadRoles, traceabilityController.getTimeline);

export default router;
