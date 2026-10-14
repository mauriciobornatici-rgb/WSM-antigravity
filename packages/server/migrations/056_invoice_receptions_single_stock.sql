-- ADR-019 (usuario, 2026-10-12): a supplier invoice covers one or several delivery notes
-- (receptions), and Tiendanube shows the same available stock as the store.
-- (No semicolons in comments: the migration runner splits statements on them.)

-- Each reception is invoiced once (unique), by one invoice that may cover several receptions.
CREATE TABLE IF NOT EXISTS supplier_invoice_receptions (
    supplier_invoice_id VARCHAR(36) NOT NULL,
    reception_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (supplier_invoice_id, reception_id),
    UNIQUE KEY uq_supplier_invoice_receptions_reception (reception_id)
);

INSERT IGNORE INTO supplier_invoice_receptions (supplier_invoice_id, reception_id)
SELECT id, reception_id FROM supplier_invoices
WHERE reception_id IS NOT NULL AND (status IS NULL OR status <> 'cancelled');

-- Optional safety stock (a policy decision, off by default): units kept out of the online
-- store. A product may override the store-wide quantity.
ALTER TABLE company_settings ADD COLUMN tiendanube_safety_stock_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE company_settings ADD COLUMN tiendanube_safety_stock INT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN tiendanube_safety_stock INT NULL;

-- Last stock published per product: the sync only calls Tiendanube when it changes.
CREATE TABLE IF NOT EXISTS tiendanube_stock_state (
    product_id VARCHAR(36) NOT NULL PRIMARY KEY,
    pushed_stock INT NOT NULL,
    pushed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
