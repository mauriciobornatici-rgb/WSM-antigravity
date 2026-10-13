-- ADR-020 (usuario, 2026-10-13): ARCA authorization that survives lost responses and crashes.
-- Before calling ARCA the number requested and its date are saved: a retry asks ARCA for
-- exactly that voucher and adopts it only if it is this document's, so nothing is issued twice
-- and nothing is lost. The credit note keeps the number ARCA gave it.
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE invoices ADD COLUMN arca_expected_number INT NULL;
ALTER TABLE invoices ADD COLUMN arca_request_date INT NULL;
ALTER TABLE invoices ADD COLUMN arca_requested_at DATETIME NULL;
ALTER TABLE invoices ADD COLUMN arca_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN arca_last_error TEXT NULL;

ALTER TABLE credit_notes ADD COLUMN arca_voucher_number INT NULL;
ALTER TABLE credit_notes ADD COLUMN arca_expected_number INT NULL;
ALTER TABLE credit_notes ADD COLUMN arca_request_date INT NULL;
ALTER TABLE credit_notes ADD COLUMN arca_requested_at DATETIME NULL;
ALTER TABLE credit_notes ADD COLUMN arca_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE credit_notes ADD COLUMN arca_last_error TEXT NULL;

-- A voucher number of ARCA belongs to one credit note only.
ALTER TABLE credit_notes ADD UNIQUE INDEX uq_credit_notes_arca_number (credit_note_type, point_of_sale, arca_voucher_number);

-- The recovery worker looks for documents left waiting for ARCA.
ALTER TABLE invoices ADD INDEX idx_invoices_arca_pending (status, arca_requested_at);
ALTER TABLE credit_notes ADD INDEX idx_credit_notes_arca_pending (status, arca_requested_at);
