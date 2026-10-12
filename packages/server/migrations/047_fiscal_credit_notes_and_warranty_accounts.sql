-- ADR-014: a credit note corrects a specific invoice (ARCA requires the associated voucher),
-- warranty costs and card fees get their own accounts.
ALTER TABLE credit_notes ADD COLUMN invoice_id VARCHAR(36) NULL;
ALTER TABLE credit_notes ADD INDEX idx_credit_notes_invoice_id (invoice_id);
INSERT IGNORE INTO chart_of_accounts (code, name, type)
VALUES ('5.1.02.03', 'Costo de garantías', 'expense');
INSERT IGNORE INTO chart_of_accounts (code, name, type)
VALUES ('5.1.02.04', 'Comisiones y gastos bancarios', 'expense');
