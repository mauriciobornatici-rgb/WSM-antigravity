import express from 'express';
import * as settingsController from '../controllers/settingsController.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';

const router = express.Router();

// All routes are authenticateToken-protected at mount level.
// Read-only profile is available to any authenticated role; writes remain admin-only.
router.get('/company/public', validate(schemas.emptyQuery), settingsController.getCompanyPublicProfile);
router.get('/company', authorizeRoles('admin'), validate(schemas.emptyQuery), settingsController.getCompanySettings);
router.put('/company', authorizeRoles('admin'), validate(schemas.companySettingsUpdate), settingsController.updateCompanySettings);
router.get('/audit-logs', authorizeRoles('admin'), validate(schemas.auditLogsFilters), settingsController.getAuditLogs);

export default router;
