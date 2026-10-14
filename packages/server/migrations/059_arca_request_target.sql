-- ADR-020 / AUD-008: what was asked of ARCA is kept with the requested number (point of sale
-- and voucher type), so a check after a change of point of sale asks about the right voucher.
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE invoices ADD COLUMN arca_pos INT NULL;
ALTER TABLE invoices ADD COLUMN arca_voucher_type INT NULL;
ALTER TABLE credit_notes ADD COLUMN arca_pos INT NULL;
ALTER TABLE credit_notes ADD COLUMN arca_voucher_type INT NULL;
