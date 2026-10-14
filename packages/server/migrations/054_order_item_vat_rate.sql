-- ADR-017 / AUD-006: a product's VAT rate can now be changed. An order keeps the rate it was
-- sold at, so changing the product later does not change what an open order bills.
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE order_items ADD COLUMN vat_rate DECIMAL(5,2) NULL;

UPDATE order_items oi
JOIN products p ON p.id = oi.product_id
SET oi.vat_rate = COALESCE(p.vat_rate, 21)
WHERE oi.vat_rate IS NULL;

-- Every return approval sums the order's earlier returns.
ALTER TABLE client_returns ADD INDEX idx_client_returns_order (order_id);

-- The gap line of channel orders imported before ADR-016 ("Envío y otros cargos") also holds
-- other charges: it is a surcharge, not a refundable shipping.
UPDATE invoice_items SET adjustment_kind = 'surcharge'
WHERE product_id IS NULL AND description = 'Envío y otros cargos';
