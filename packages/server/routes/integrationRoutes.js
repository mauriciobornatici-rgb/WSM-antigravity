import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Tienda Nube OAuth
router.get('/tiendanube/authorize', authenticateToken, integrationController.authorizeTiendaNube);
router.get('/tiendanube/callback', integrationController.callbackTiendaNube);

// Tienda Nube Webhooks
router.post('/tiendanube/webhooks/orders/created', integrationController.webhookOrdersCreated);

export default router;
