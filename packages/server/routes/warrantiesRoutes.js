import express from 'express';
import * as controller from '../controllers/warrantiesController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const warrantyRoles = authorizeRoles('admin', 'manager', 'cashier');
const creditNoteWriteRoles = authorizeRoles('admin', 'manager');

// Warranties
router.get('/warranties', warrantyRoles, validate(schemas.warrantiesFilters), controller.getWarranties);
router.post('/warranties', warrantyRoles, validate(schemas.warrantyCreate), controller.createWarranty);
router.put('/warranties/:id/status', warrantyRoles, validate(schemas.warrantyStatusUpdate), controller.updateWarrantyStatus);

// Client Returns
router.get('/client-returns', warrantyRoles, validate(schemas.clientReturnsFilters), controller.getReturns);
router.post('/client-returns', warrantyRoles, validate(schemas.clientReturnCreate), controller.createReturn);
router.post('/client-returns/:id/approve', warrantyRoles, validate(schemas.idParam), controller.approveReturn);

// Credit Notes
router.get('/credit-notes', warrantyRoles, validate(schemas.creditNotesFilters), controller.getCreditNotes);
router.post('/credit-notes', creditNoteWriteRoles, validate(schemas.creditNoteCreate), controller.createCreditNote);

export default router;
