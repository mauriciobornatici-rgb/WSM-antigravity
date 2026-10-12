import express from 'express';
import * as financeController from '../controllers/financeController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const accountingRoles = authorizePermission(PERMISSIONS.ACCOUNTING_MANAGE);
const cashRoles = authorizePermission(PERMISSIONS.CASH_MANAGE);
const collectionsRoles = authorizePermission(PERMISSIONS.COLLECTIONS_MANAGE);
const supplierPaymentRoles = authorizePermission(PERMISSIONS.SUPPLIER_PAYMENTS_MANAGE);

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

// "Caja 2" / treasury cash (ADR-015). Managers see it (ADR-016); moving money is accounting.
router.get('/treasury', authorizePermission(PERMISSIONS.TREASURY_READ), financeController.getTreasury);
router.post('/treasury/transfers', accountingRoles, validate(schemas.treasuryTransfer), financeController.createTreasuryTransfer);

// Bank account and its debits (ADR-016)
router.get('/bank', accountingRoles, financeController.getBank);
router.post('/bank/charges', accountingRoles, validate(schemas.bankCharges), financeController.createBankCharges);

// VAT rates for fees and bank debits (ADR-016)
router.get('/vat-rates', accountingRoles, financeController.getVatRates);
router.post('/vat-rates', authorizePermission(PERMISSIONS.SETTINGS_MANAGE), validate(schemas.vatRateCreate), financeController.createVatRate);
router.put('/vat-rates/:id', authorizePermission(PERMISSIONS.SETTINGS_MANAGE), validate(schemas.vatRateUpdate), financeController.updateVatRate);

// Card/QR settlements (Tarjetas y QR a cobrar -> Banco)
router.get('/card-settlements', accountingRoles, financeController.getCardSettlements);
router.post('/card-settlements', accountingRoles, validate(schemas.cardSettlement), financeController.createCardSettlement);

// Collections
router.get('/collections/pending-invoices', collectionsRoles, financeController.getPendingInvoices);
router.get('/collections/fiscal-status', collectionsRoles, financeController.getFiscalSalesStatus);
router.post('/collections', collectionsRoles, financeController.registerBulkPayments);
router.get('/checks', collectionsRoles, financeController.getCustomerChecks);
router.get('/checks/:id', collectionsRoles, validate(schemas.idParam), financeController.getCustomerCheck);
router.put('/checks/:id/status', collectionsRoles, validate(schemas.idParam), financeController.updateCustomerCheckStatus);
router.get('/outgoing-checks', supplierPaymentRoles, financeController.getOutgoingChecks);
router.get('/outgoing-checks/:id', supplierPaymentRoles, validate(schemas.idParam), financeController.getOutgoingCheck);
router.put('/outgoing-checks/:id/status', supplierPaymentRoles, validate(schemas.idParam), financeController.updateOutgoingCheckStatus);

export default router;
