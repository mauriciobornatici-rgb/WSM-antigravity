import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authenticateToken, authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';
import { z } from 'zod';
import {
    onlineStoreCatalogQuerySchema,
    onlineStoreFulfillmentUpdateSchema,
    onlineStoreOrderQuerySchema,
    onlineStoreProductCreateSchema,
    onlineStoreProductUpdateSchema,
    onlineStoreTrackingEventSchema,
    uuidSchema
} from '@wsm/common';
import { validateZod } from '../middleware/validationMiddleware.js';

const router = express.Router();
const onlineRead = [authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_READ)];
const onlineManage = [authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_MANAGE)];
const uuidParams = z.object({ params: z.object({ id: uuidSchema }) });
const fulfillmentParams = z.object({ params: z.object({ id: z.string().trim().min(10).max(100) }) });

// Tienda Nube OAuth
router.get('/tiendanube/authorize', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.authorizeTiendaNube);
router.get('/tiendanube/callback', integrationController.callbackTiendaNube);

// Tienda Nube Webhooks
router.post('/tiendanube/webhooks', integrationController.webhookTiendaNube);
router.post('/tiendanube/webhooks/orders/created', integrationController.webhookOrdersCreated);

// Tienda Nube Sync Manual (Respaldo) — operaciones masivas, solo admin
router.post('/tiendanube/sync-orders', authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_MANAGE), integrationController.syncRecentOrdersController);
router.post('/tiendanube/auto-link', authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_MANAGE), integrationController.autoLinkCatalogController);
router.get('/tiendanube/status', authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_READ), integrationController.getTiendaNubeStatusController);
router.post('/tiendanube/webhook/ensure', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.ensureTiendaNubeWebhookController);
router.post('/tiendanube/disconnect', authenticateToken, authorizePermission(PERMISSIONS.INTEGRATIONS_MANAGE), integrationController.disconnectTiendaNubeController);

// Tienda Nube Failed Syncs (Retry Queue) — solo admin
router.get('/tiendanube/failed-syncs', authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_READ), integrationController.getFailedSyncsController);
router.post('/tiendanube/failed-syncs/retry-all', authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_MANAGE), integrationController.retryAllFailedSyncsController);
router.post('/tiendanube/failed-syncs/:id/retry', authenticateToken, authorizePermission(PERMISSIONS.ONLINE_STORE_MANAGE), integrationController.retryFailedSyncController);

// Dedicated Tiendanube operations hub. Credentials and OAuth remain in Settings.
router.get('/tiendanube/operations/overview', ...onlineRead, integrationController.getOperationsOverviewController);
router.get('/tiendanube/operations/catalog', ...onlineRead,
    validateZod(z.object({ query: onlineStoreCatalogQuerySchema })), integrationController.listCatalogController);
router.post('/tiendanube/operations/catalog', ...onlineManage,
    validateZod(z.object({ body: onlineStoreProductCreateSchema })), integrationController.createCatalogController);
router.put('/tiendanube/operations/catalog/:id', ...onlineManage,
    validateZod(uuidParams.extend({ body: onlineStoreProductUpdateSchema })), integrationController.updateCatalogController);
router.delete('/tiendanube/operations/catalog/:id', ...onlineManage,
    validateZod(uuidParams), integrationController.archiveCatalogController);
router.post('/tiendanube/operations/catalog/:id/publish', ...onlineManage,
    validateZod(uuidParams), integrationController.publishCatalogController);
router.post('/tiendanube/operations/catalog/import', ...onlineManage,
    validateZod(z.object({ body: z.object({ q: z.string().trim().max(200).optional() }).optional() })), integrationController.importCatalogController);
router.get('/tiendanube/operations/orders', ...onlineRead,
    validateZod(z.object({ query: onlineStoreOrderQuerySchema })), integrationController.listOperationsOrdersController);
router.get('/tiendanube/operations/customers', ...onlineRead,
    validateZod(z.object({ query: onlineStoreCatalogQuerySchema.pick({ page: true, limit: true, q: true }) })), integrationController.listOperationsCustomersController);
router.get('/tiendanube/operations/fulfillments', ...onlineRead,
    validateZod(z.object({ query: onlineStoreOrderQuerySchema.pick({ page: true, limit: true, q: true, shipping_status: true }) })), integrationController.listFulfillmentsController);
router.post('/tiendanube/operations/fulfillments/sync', authenticateToken,
    authorizePermission(PERMISSIONS.ORDERS_DISPATCH), integrationController.syncFulfillmentsController);
router.patch('/tiendanube/operations/fulfillments/:id', authenticateToken,
    authorizePermission(PERMISSIONS.ORDERS_DISPATCH),
    validateZod(fulfillmentParams.extend({ body: onlineStoreFulfillmentUpdateSchema })), integrationController.updateFulfillmentController);
router.post('/tiendanube/operations/fulfillments/:id/tracking-events', authenticateToken,
    authorizePermission(PERMISSIONS.ORDERS_DISPATCH),
    validateZod(fulfillmentParams.extend({ body: onlineStoreTrackingEventSchema })), integrationController.createTrackingEventController);
router.get('/tiendanube/operations/analytics', ...onlineRead, integrationController.getOperationsAnalyticsController);
router.get('/tiendanube/operations/sync-center', ...onlineRead, integrationController.getSyncCenterController);

export default router;
