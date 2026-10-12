-- Align legacy product/inventory tables with the canonical bootstrap schema.
-- Each ADD is separate so fresh databases can safely recover duplicate columns.
ALTER TABLE products ADD COLUMN unit_measure VARCHAR(50) NULL DEFAULT 'unit' AFTER brand;
ALTER TABLE products ADD COLUMN cost_price DECIMAL(15,2) NULL DEFAULT 0 AFTER purchase_price;
ALTER TABLE products ADD COLUMN stock_current INT NULL DEFAULT 0 AFTER sale_price;
ALTER TABLE products ADD COLUMN stock_min INT NULL DEFAULT 0 AFTER stock_current;
ALTER TABLE products ADD COLUMN status VARCHAR(20) NULL DEFAULT 'active' AFTER supplier_id;

ALTER TABLE products MODIFY COLUMN purchase_price DECIMAL(15,2) NULL DEFAULT 0;
ALTER TABLE products MODIFY COLUMN sale_price DECIMAL(15,2) NULL DEFAULT 0;

ALTER TABLE inventory_movements MODIFY COLUMN type VARCHAR(50) NOT NULL;
ALTER TABLE inventory_movements MODIFY COLUMN reference_type VARCHAR(50) NULL;
