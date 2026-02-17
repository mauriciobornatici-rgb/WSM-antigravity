import express from 'express';
import * as financeController from '../controllers/financeController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const accountingRoles = authorizeRoles('admin');
const cashRoles = authorizeRoles('admin', 'cashier');

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

export default router;
