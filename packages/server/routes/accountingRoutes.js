import express from 'express';
import * as accountingController from '../controllers/accountingController.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const accountingRoles = authorizePermission(PERMISSIONS.ACCOUNTING_MANAGE);

router.get('/chart-of-accounts', accountingRoles, accountingController.getChartOfAccounts);
router.post('/chart-of-accounts', accountingRoles, accountingController.createAccount);
router.put('/chart-of-accounts/:code', accountingRoles, accountingController.updateAccount);
router.delete('/chart-of-accounts/:code', accountingRoles, accountingController.deleteAccount);

router.get('/journal-entries', accountingRoles, accountingController.getJournalEntries);
router.post('/journal-entries', accountingRoles, accountingController.createManualEntry);
router.post('/journal-entries/:id/reverse', accountingRoles, accountingController.reverseJournalEntry);

router.get('/trial-balance', accountingRoles, accountingController.getTrialBalance);
router.get('/income-statement', accountingRoles, accountingController.getIncomeStatement);
router.get('/balance-sheet', accountingRoles, accountingController.getBalanceSheet);

export default router;
