import express from 'express';
import * as settingsController from '../controllers/settingsController.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';
import { validate, schemas } from '../middleware/validationMiddleware.js';

const router = express.Router();

// All routes are authenticateToken-protected at mount level.
// Read-only profile is available to any authenticated role; writes require settings.manage.
router.get('/company/public', validate(schemas.emptyQuery), settingsController.getCompanyPublicProfile);
router.get('/company', authorizePermission(PERMISSIONS.SETTINGS_MANAGE), validate(schemas.emptyQuery), settingsController.getCompanySettings);
router.put('/company', authorizePermission(PERMISSIONS.SETTINGS_MANAGE), validate(schemas.companySettingsUpdate), settingsController.updateCompanySettings);
router.get('/audit-logs', authorizePermission(PERMISSIONS.SETTINGS_MANAGE), validate(schemas.auditLogsFilters), settingsController.getAuditLogs);
router.post('/afip/test-connection', authorizePermission(PERMISSIONS.SETTINGS_MANAGE), settingsController.testAfipConnection);

export default router;
