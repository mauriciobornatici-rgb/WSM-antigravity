-- ADR-016 (usuario, 2026-10-12): bank charges, selectable VAT rates, order adjustments
-- (shipping and discounts on the invoice) and exact refunds of partial returns.
-- (No semicolons in comments: the migration runner splits statements on them.)

-- Bank debits other than the processor fee, and VAT accounts for every ARCA rate.
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('5.1.02.05', 'Impuesto a los débitos y créditos bancarios', 'expense'),
    ('1.1.05.04', 'Retenciones y percepciones sufridas', 'asset'),
    ('1.1.05.05', 'IVA Crédito Fiscal (5%)', 'asset'),
    ('1.1.05.06', 'IVA Crédito Fiscal (2.5%)', 'asset'),
    ('2.1.02.04', 'IVA Débito Fiscal (5%)', 'liability'),
    ('2.1.02.05', 'IVA Débito Fiscal (2.5%)', 'liability');

-- VAT rates the user can pick for bank and processor fees. 21 % is the default, and 0 means
-- the VAT is not computable (it stays in the expense).
CREATE TABLE IF NOT EXISTS vat_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    rate DECIMAL(5,2) NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vat_rates_name (name)
);

INSERT IGNORE INTO vat_rates (name, rate, is_default) VALUES
    ('IVA 21%', 21.00, 1),
    ('IVA 10,5%', 10.50, 0),
    ('IVA 27%', 27.00, 0),
    ('Sin IVA computable', 0.00, 0);

-- Order lines that are not products: shipping charged to the customer, discounts and other
-- surcharges reported by the sales channel. They go to the invoice next to the detail.
-- amount is the final (VAT-included) amount, negative for a discount.
CREATE TABLE IF NOT EXISTS order_adjustments (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    vat_rate DECIMAL(5,2) NOT NULL DEFAULT 21.00,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_order_adjustments_order (order_id),
    CONSTRAINT fk_order_adjustments_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
);

-- What each returned line refunded (final amount and its VAT): the credit note and its
-- lines in ARCA reuse these exact amounts.
ALTER TABLE client_return_items ADD COLUMN refund_amount DECIMAL(15,2) NULL;
ALTER TABLE client_return_items ADD COLUMN refund_vat DECIMAL(15,2) NULL;
