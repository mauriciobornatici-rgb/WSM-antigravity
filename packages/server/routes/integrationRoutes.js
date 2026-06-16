import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Tienda Nube OAuth
router.get('/tiendanube/authorize', authenticateToken, integrationController.authorizeTiendaNube);
router.get('/tiendanube/callback', integrationController.callbackTiendaNube);

// Tienda Nube Webhooks
router.post('/tiendanube/webhooks', integrationController.webhookTiendaNube);
router.post('/tiendanube/webhooks/orders/created', integrationController.webhookOrdersCreated);

// Tienda Nube Sync Manual (Respaldo)
router.post('/tiendanube/sync-orders', authenticateToken, integrationController.syncRecentOrdersController);
router.post('/tiendanube/auto-link', authenticateToken, integrationController.autoLinkCatalogController);

// Tienda Nube Failed Syncs (Retry Queue)
router.get('/tiendanube/failed-syncs', authenticateToken, integrationController.getFailedSyncsController);
router.post('/tiendanube/failed-syncs/:id/retry', authenticateToken, integrationController.retryFailedSyncController);
router.post('/tiendanube/failed-syncs/retry-all', authenticateToken, integrationController.retryAllFailedSyncsController);

export default router;
