import accountingService from '../services/accounting.service.js';
import catchAsync from '../utils/catchAsync.js';

export const getChartOfAccounts = catchAsync(async (req, res) => {
    const coa = await accountingService.getChartOfAccounts();
    res.json(coa);
});

export const getJournalEntries = catchAsync(async (req, res) => {
    const { start_date, end_date, reference_type, reference_id } = req.query;
    const entries = await accountingService.getJournalEntries({
        start_date,
        end_date,
        reference_type,
        reference_id
    });
    res.json(entries);
});

export const getTrialBalance = catchAsync(async (req, res) => {
    const { start_date, end_date } = req.query;
    const balance = await accountingService.getTrialBalance({ start_date, end_date });
    res.json(balance);
});

export const getIncomeStatement = catchAsync(async (req, res) => {
    const { start_date, end_date } = req.query;
    const incomeStatement = await accountingService.getIncomeStatement({ start_date, end_date });
    res.json(incomeStatement);
});

export const createManualEntry = catchAsync(async (req, res) => {
    const result = await accountingService.createManualEntry(req.body, req.user?.id);
    res.status(201).json(result);
});

export const createAccount = catchAsync(async (req, res) => {
    const result = await accountingService.createAccount(req.body, req.user?.id);
    res.status(201).json(result);
});

export const updateAccount = catchAsync(async (req, res) => {
    const result = await accountingService.updateAccount(req.params.code, req.body, req.user?.id);
    res.json(result);
});

export const deleteAccount = catchAsync(async (req, res) => {
    const result = await accountingService.deleteAccount(req.params.code, req.user?.id);
    res.json(result);
});

export const deleteJournalEntry = catchAsync(async (req, res) => {
    const result = await accountingService.deleteJournalEntry(req.params.id, req.user?.id);
    res.json(result);
});

export const reverseJournalEntry = catchAsync(async (req, res) => {
    const result = await accountingService.reverseJournalEntry(req.params.id, req.user?.id);
    res.json(result);
});

export const updateJournalEntry = catchAsync(async (req, res) => {
    const result = await accountingService.updateJournalEntry(req.params.id, req.body, req.user?.id);
    res.json(result);
});
