-- Prevent retries from duplicating POS invoices or cash-shift entries.
ALTER TABLE invoices
    ADD UNIQUE KEY uq_invoices_order_id (order_id);

UPDATE shift_payments SET type = 'sale' WHERE type IS NULL;

ALTER TABLE shift_payments
    MODIFY COLUMN type VARCHAR(20) NOT NULL DEFAULT 'sale';

ALTER TABLE shift_payments
    ADD UNIQUE KEY uq_shift_payment_order_method (shift_id, order_id, payment_method, type);

ALTER TABLE shift_payments
    ADD CONSTRAINT fk_shift_payments_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE RESTRICT;
