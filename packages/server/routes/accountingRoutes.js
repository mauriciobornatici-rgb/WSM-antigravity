import express from 'express';
import * as accountingController from '../controllers/accountingController.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const accountingRoles = authorizeRoles('admin', 'manager');

router.get('/chart-of-accounts', accountingRoles, accountingController.getChartOfAccounts);
router.post('/chart-of-accounts', accountingRoles, accountingController.createAccount);
router.put('/chart-of-accounts/:code', accountingRoles, accountingController.updateAccount);
router.delete('/chart-of-accounts/:code', accountingRoles, accountingController.deleteAccount);

router.get('/journal-entries', accountingRoles, accountingController.getJournalEntries);
router.post('/journal-entries', accountingRoles, accountingController.createManualEntry);
router.put('/journal-entries/:id', accountingRoles, accountingController.updateJournalEntry);
router.delete('/journal-entries/:id', accountingRoles, accountingController.deleteJournalEntry);
router.post('/journal-entries/:id/reverse', accountingRoles, accountingController.reverseJournalEntry);

router.get('/trial-balance', accountingRoles, accountingController.getTrialBalance);
router.get('/income-statement', accountingRoles, accountingController.getIncomeStatement);

export default router;
