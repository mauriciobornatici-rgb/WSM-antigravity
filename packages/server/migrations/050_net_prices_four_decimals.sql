-- ADR-015: prices are shown and set VAT-included ("precio final") but stored net. With two
-- decimals some final prices cannot be represented (one net cent = 1.21 final cents), so a
-- price set as $59.999 could come back as $59.998,99. Four decimals make every final price
-- exact. Widening DECIMAL keeps every existing value unchanged.
ALTER TABLE products MODIFY COLUMN sale_price DECIMAL(15,4) NULL DEFAULT 0;
ALTER TABLE order_items MODIFY COLUMN unit_price DECIMAL(15,4) NOT NULL;
ALTER TABLE invoice_items MODIFY COLUMN unit_price DECIMAL(15,4) NOT NULL;
ALTER TABLE client_return_items MODIFY COLUMN unit_price DECIMAL(15,4) NULL DEFAULT 0;
