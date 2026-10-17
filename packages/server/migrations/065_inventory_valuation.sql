-- ADR-027 (usuario, 2026-10-17): goods valued at the last purchase cost (opción a).
-- 2.1.01.02: goods received and not yet invoiced by the supplier. The reception credits it and
-- the supplier invoice debits it, so the stock enters the ledger when it enters the warehouse.
-- inventory_movements.journal_entry_id: the entry that valued each movement (the cost of goods
-- sold is posted when the goods leave, not when they are invoiced). NULL for older movements.
-- The reference index serves the lookups of the movements of an order or a document.
-- company_settings.inventory_valuation_since: when the valuation script aligned the ledger with
-- the stock (NULL until it runs).
-- products.auto_update_cost: a purchase at another cost changes the product cost (default yes).
-- When off, the cost stays and the difference goes to the holding result.
-- products.auto_update_price: when the cost changes, the sale price follows it keeping the
-- markup (default yes). When off, the price stays as loaded.
-- Reverse: DROP the three product and settings columns, DROP INDEX and the movements column,
-- and DELETE the account (only while no entry uses it).
-- (No semicolons in comments: the migration runner splits statements on them.)
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('2.1.01.02', 'Mercadería recibida a facturar', 'liability');
ALTER TABLE inventory_movements ADD COLUMN journal_entry_id VARCHAR(36) NULL;
ALTER TABLE inventory_movements ADD INDEX idx_inventory_movements_journal_entry (journal_entry_id);
ALTER TABLE inventory_movements ADD INDEX idx_inventory_movements_reference (reference_id, type);
ALTER TABLE company_settings ADD COLUMN inventory_valuation_since DATETIME NULL;
ALTER TABLE products ADD COLUMN auto_update_cost TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN auto_update_price TINYINT(1) NOT NULL DEFAULT 1;
