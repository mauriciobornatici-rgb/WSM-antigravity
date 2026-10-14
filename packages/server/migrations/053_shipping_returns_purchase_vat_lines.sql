-- ADR-017 (usuario, 2026-10-12): shipping charged or not, shipping refunded on a return,
-- purchases with several VAT rates or that are not goods, and where each product came from.
-- (No semicolons in comments: the migration runner splits statements on them.)

-- Freight the business pays (the carrier's invoice) is an expense, not goods.
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('5.1.02.06', 'Fletes y envíos', 'expense');

-- What a non-product invoice line is: shipping, a discount on the shipping, a discount on
-- the products or a surcharge. Lines from before ADR-017 are classified by their description.
ALTER TABLE invoice_items ADD COLUMN adjustment_kind VARCHAR(20) NULL;

UPDATE invoice_items SET adjustment_kind = CASE
        WHEN description LIKE 'Envío%' THEN 'shipping'
        WHEN description LIKE 'Descuento sobre el envío%' THEN 'shipping_discount'
        WHEN total_line < 0 THEN 'discount'
        ELSE 'surcharge'
    END
WHERE product_id IS NULL AND adjustment_kind IS NULL
  AND EXISTS (SELECT 1 FROM order_adjustments oa
              JOIN invoices i ON i.order_id = oa.order_id
              WHERE i.id = invoice_items.invoice_id);

-- A shipping the business absorbs is kept on the order (amount and rate) but not billed.
ALTER TABLE order_adjustments ADD COLUMN billable TINYINT(1) NOT NULL DEFAULT 1;

UPDATE order_adjustments SET kind = 'shipping_discount'
WHERE kind = 'discount' AND description LIKE 'Descuento sobre el envío%';

-- A return can also give back the shipping (a commercial decision per return).
ALTER TABLE client_returns ADD COLUMN refund_shipping TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE client_returns ADD COLUMN shipping_refund_amount DECIMAL(15,2) NULL;
ALTER TABLE client_returns ADD COLUMN shipping_refund_vat DECIMAL(15,2) NULL;
ALTER TABLE client_returns ADD COLUMN shipping_refund_rate DECIMAL(5,2) NULL;

-- A supplier invoice for goods, freight or another expense, and its VAT per rate.
ALTER TABLE supplier_invoices ADD COLUMN purchase_kind VARCHAR(20) NOT NULL DEFAULT 'goods';

CREATE TABLE IF NOT EXISTS supplier_invoice_vat_lines (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    supplier_invoice_id VARCHAR(36) NOT NULL,
    vat_rate DECIMAL(5,2) NOT NULL,
    net_amount DECIMAL(15,2) NOT NULL,
    vat_amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_supplier_invoice_vat_lines_invoice (supplier_invoice_id)
);

-- Where a product was created: in the ERP, from "Tienda online" or imported from Tiendanube.
-- Unknown (NULL) for products created before ADR-017.
ALTER TABLE products ADD COLUMN origin VARCHAR(30) NULL;
