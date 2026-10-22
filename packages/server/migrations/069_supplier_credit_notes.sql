-- ADR-029 (usuario, 2026-10-21).
-- 1.1.06.01: what a supplier invoice charged beyond the units its delivery notes had left (units
-- never received, returned, or already invoiced). The supplier owes a credit note for it.
-- supplier_invoice_items.excess_quantity: the units of the line charged beyond what was left.
-- supplier_invoices.credit_expected_amount: what the invoice put in 1.1.06.01.
-- supplier_credit_notes: the supplier's credit notes, each against one invoice. applied_amount is
-- what it settled of 1.1.06.01 (the rest of its value is holding result).
-- No foreign keys on purpose (as 060 and 067): a database seeded before may hold another collation,
-- and the migration runs at start-up. The service checks the supplier and the invoice under lock.
-- Reverse: DROP TABLE supplier_credit_note_vat_lines, DROP TABLE supplier_credit_notes, DROP COLUMN
-- credit_expected_amount, DROP COLUMN excess_quantity (only while 1.1.06.01 has no movements).
-- (No semicolons in comments: the migration runner splits statements on them.)
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('1.1.06.01', 'Notas de crédito a recibir de proveedores', 'asset');

ALTER TABLE supplier_invoice_items ADD COLUMN excess_quantity INT NOT NULL DEFAULT 0;

ALTER TABLE supplier_invoices ADD COLUMN credit_expected_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00;

CREATE TABLE IF NOT EXISTS supplier_credit_notes (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    supplier_id VARCHAR(36) NOT NULL,
    supplier_invoice_id VARCHAR(36) NOT NULL,
    credit_note_type VARCHAR(10) NOT NULL,
    credit_note_number VARCHAR(100) NOT NULL,
    issue_date DATE NOT NULL,
    net_amount DECIMAL(15,2) NOT NULL,
    vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    other_taxes DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(15,2) NOT NULL,
    applied_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    notes TEXT NULL,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_credit_notes_number (supplier_id, credit_note_type, credit_note_number),
    INDEX idx_supplier_credit_notes_invoice (supplier_invoice_id),
    CONSTRAINT chk_supplier_credit_notes_applied CHECK (applied_amount >= 0 AND applied_amount <= total_amount)
);

CREATE TABLE IF NOT EXISTS supplier_credit_note_vat_lines (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    supplier_credit_note_id VARCHAR(36) NOT NULL,
    vat_rate DECIMAL(5,2) NOT NULL,
    net_amount DECIMAL(15,2) NOT NULL,
    vat_amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_supplier_credit_note_vat_lines_note (supplier_credit_note_id)
);
