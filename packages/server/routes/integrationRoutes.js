import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

// Tienda Nube OAuth
router.get('/tiendanube/authorize', authenticateToken, integrationController.authorizeTiendaNube);
router.get('/tiendanube/callback', integrationController.callbackTiendaNube);

// Tienda Nube Webhooks
router.post('/tiendanube/webhooks', integrationController.webhookTiendaNube);
router.post('/tiendanube/webhooks/orders/created', integrationController.webhookOrdersCreated);

// Tienda Nube Sync Manual (Respaldo) — operaciones masivas, solo admin
router.post('/tiendanube/sync-orders', authenticateToken, authorizeRoles('admin'), integrationController.syncRecentOrdersController);
router.post('/tiendanube/auto-link', authenticateToken, authorizeRoles('admin'), integrationController.autoLinkCatalogController);

// Tienda Nube Failed Syncs (Retry Queue) — solo admin
router.get('/tiendanube/failed-syncs', authenticateToken, authorizeRoles('admin'), integrationController.getFailedSyncsController);
router.post('/tiendanube/failed-syncs/:id/retry', authenticateToken, authorizeRoles('admin'), integrationController.retryFailedSyncController);
router.post('/tiendanube/failed-syncs/retry-all', authenticateToken, authorizeRoles('admin'), integrationController.retryAllFailedSyncsController);

export default router;
