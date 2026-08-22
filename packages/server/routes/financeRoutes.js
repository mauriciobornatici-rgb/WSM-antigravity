import express from 'express';
import * as financeController from '../controllers/financeController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const accountingRoles = authorizePermission(PERMISSIONS.ACCOUNTING_MANAGE);
const cashRoles = authorizePermission(PERMISSIONS.CASH_MANAGE);
const collectionsRoles = authorizePermission(PERMISSIONS.COLLECTIONS_MANAGE);

// Transactions
router.get('/transactions', accountingRoles, validate(schemas.transactionsFilters), financeController.getTransactions);
router.post('/cash-transactions', cashRoles, validate(schemas.cashTransaction), financeController.createCashTransaction);

// Cash registers
router.get('/cash-registers', cashRoles, financeController.getCashRegisters);
router.get('/cash-registers/:id/transactions', cashRoles, validate(schemas.idParam), financeController.getCashRegisterTransactions);
router.get('/cash-registers/:id/shift', cashRoles, validate(schemas.idParam), financeController.getOpenShift);
router.post('/cash-registers/:id/open', cashRoles, validate(schemas.cashShiftOpen), financeController.openShift);

// Cash shifts
router.post('/cash-shifts/:id/close', cashRoles, validate(schemas.cashShiftClose), financeController.closeShift);
router.post('/cash-shifts/:id/payments', cashRoles, validate(schemas.shiftPayment), financeController.addShiftPayment);

// Collections
router.get('/collections/pending-invoices', collectionsRoles, financeController.getPendingInvoices);
router.get('/collections/fiscal-status', collectionsRoles, financeController.getFiscalSalesStatus);
router.post('/collections', collectionsRoles, financeController.registerBulkPayments);
router.get('/checks', collectionsRoles, financeController.getCustomerChecks);
router.get('/checks/:id', collectionsRoles, validate(schemas.idParam), financeController.getCustomerCheck);
router.put('/checks/:id/status', collectionsRoles, validate(schemas.idParam), financeController.updateCustomerCheckStatus);

export default router;
