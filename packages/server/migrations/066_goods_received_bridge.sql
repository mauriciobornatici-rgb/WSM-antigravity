-- ADR-027 (usuario, 2026-10-17): the goods enter the ledger when they enter the warehouse, against
-- 2.1.01.02 "Mercadería recibida a facturar", and the supplier invoice clears that account.
-- supplier_invoice_receptions.cleared_amount: what the invoice cleared from 2.1.01.02 for each
-- delivery note (NULL for delivery notes received before the rule, which never went through it).
-- reception_items.returned_quantity: units returned to the supplier against that delivery note
-- before it was invoiced (D7). The invoice only clears what was not returned.
-- supplier_returns.reception_id: the delivery note a supplier return is made against (D7).
-- Reverse: DROP the three columns and the index.
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE supplier_invoice_receptions ADD COLUMN cleared_amount DECIMAL(15,2) NULL;
ALTER TABLE reception_items ADD COLUMN returned_quantity INT NOT NULL DEFAULT 0;
ALTER TABLE supplier_returns ADD COLUMN reception_id VARCHAR(36) NULL;
ALTER TABLE supplier_returns ADD INDEX idx_supplier_returns_reception (reception_id);
