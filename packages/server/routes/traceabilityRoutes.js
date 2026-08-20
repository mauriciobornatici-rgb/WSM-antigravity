import express from 'express';
import * as traceabilityController from '../controllers/traceabilityController.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const traceabilityReadRoles = authorizePermission(PERMISSIONS.TRACEABILITY_READ);

router.get('/traceability/timeline', traceabilityReadRoles, traceabilityController.getTimeline);

export default router;
