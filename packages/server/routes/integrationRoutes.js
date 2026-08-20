import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authenticateToken, authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();

// Tienda Nube OAuth
router.get('/tiendanube/authorize', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.authorizeTiendaNube);
router.get('/tiendanube/callback', integrationController.callbackTiendaNube);

// Tienda Nube Webhooks
router.post('/tiendanube/webhooks', integrationController.webhookTiendaNube);
router.post('/tiendanube/webhooks/orders/created', integrationController.webhookOrdersCreated);

// Tienda Nube Sync Manual (Respaldo) — operaciones masivas, solo admin
router.post('/tiendanube/sync-orders', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.syncRecentOrdersController);
router.post('/tiendanube/auto-link', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.autoLinkCatalogController);
router.get('/tiendanube/status', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.getTiendaNubeStatusController);
router.post('/tiendanube/webhook/ensure', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.ensureTiendaNubeWebhookController);
router.post('/tiendanube/disconnect', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.disconnectTiendaNubeController);

// Tienda Nube Failed Syncs (Retry Queue) — solo admin
router.get('/tiendanube/failed-syncs', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.getFailedSyncsController);
router.post('/tiendanube/failed-syncs/retry-all', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.retryAllFailedSyncsController);
router.post('/tiendanube/failed-syncs/:id/retry', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.retryFailedSyncController);

export default router;
