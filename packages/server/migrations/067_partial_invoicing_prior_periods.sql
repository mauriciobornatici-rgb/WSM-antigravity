-- ADR-028 (usuario y contadora, 2026-10-21).
-- 3.1.02.02: corrections of earlier fiscal years go to equity (RT 17, AREA), not to the result of
-- the year: the valuation transition adjustment and the cost of goods sold of earlier years.
-- reception_items.invoiced_quantity: units of the delivery note line the supplier already invoiced.
-- A delivery note may be invoiced in parts, by several invoices. Lines of delivery notes already
-- linked to an invoice count as invoiced in full (what was kept).
-- supplier_invoice_items: what each invoice charged per delivery note line (units, net unit cost,
-- and what it cleared from 2.1.01.02).
-- Reverse: DROP TABLE supplier_invoice_items, DROP COLUMN invoiced_quantity, put back the unique
-- key on supplier_invoice_receptions.reception_id (only while no delivery note has two invoices).
-- (No semicolons in comments: the migration runner splits statements on them.)
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('3.1.02.02', 'Ajuste de resultados de ejercicios anteriores', 'equity');

ALTER TABLE reception_items ADD COLUMN invoiced_quantity INT NOT NULL DEFAULT 0;

UPDATE reception_items ri
JOIN (SELECT DISTINCT reception_id FROM supplier_invoice_receptions) sir ON sir.reception_id = ri.reception_id
SET ri.invoiced_quantity = GREATEST(ri.quantity_received - ri.returned_quantity, 0);

CREATE TABLE IF NOT EXISTS supplier_invoice_items (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    supplier_invoice_id VARCHAR(36) NOT NULL,
    reception_id VARCHAR(36) NOT NULL,
    reception_item_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    unit_cost DECIMAL(15,2) NOT NULL,
    cleared_amount DECIMAL(15,2) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_supplier_invoice_items_invoice (supplier_invoice_id),
    INDEX idx_supplier_invoice_items_reception_item (reception_item_id),
    INDEX idx_supplier_invoice_items_product (product_id)
);

ALTER TABLE supplier_invoice_receptions ADD INDEX idx_supplier_invoice_receptions_reception (reception_id);
ALTER TABLE supplier_invoice_receptions DROP INDEX uq_supplier_invoice_receptions_reception;
