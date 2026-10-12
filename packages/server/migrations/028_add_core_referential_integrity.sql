-- Normalize orphaned values only for nullable relationships before adding constraints.
UPDATE products child
LEFT JOIN suppliers parent ON parent.id = child.supplier_id
SET child.supplier_id = NULL
WHERE child.supplier_id IS NOT NULL AND parent.id IS NULL;

UPDATE inventory_movements child
LEFT JOIN users parent ON parent.id = child.performed_by
SET child.performed_by = NULL
WHERE child.performed_by IS NOT NULL AND parent.id IS NULL;

UPDATE orders child
LEFT JOIN clients parent ON parent.id = child.client_id
SET child.client_id = NULL
WHERE child.client_id IS NOT NULL AND parent.id IS NULL;

UPDATE invoices child
LEFT JOIN orders parent ON parent.id = child.order_id
SET child.order_id = NULL
WHERE child.order_id IS NOT NULL AND parent.id IS NULL;

UPDATE invoices child
LEFT JOIN clients parent ON parent.id = child.client_id
SET child.client_id = NULL
WHERE child.client_id IS NOT NULL AND parent.id IS NULL;

UPDATE invoice_items child
LEFT JOIN products parent ON parent.id = child.product_id
SET child.product_id = NULL
WHERE child.product_id IS NOT NULL AND parent.id IS NULL;

ALTER TABLE products
    ADD CONSTRAINT fk_products_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    ON DELETE SET NULL;

ALTER TABLE inventory
    ADD CONSTRAINT fk_inventory_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT;

ALTER TABLE inventory_movements
    ADD CONSTRAINT fk_inventory_movements_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT;

ALTER TABLE inventory_movements
    ADD CONSTRAINT fk_inventory_movements_user
    FOREIGN KEY (performed_by) REFERENCES users(id)
    ON DELETE SET NULL;

ALTER TABLE orders
    ADD CONSTRAINT fk_orders_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL;

ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE;

ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT;

ALTER TABLE invoices
    ADD CONSTRAINT fk_invoices_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE SET NULL;

ALTER TABLE invoices
    ADD CONSTRAINT fk_invoices_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE SET NULL;

ALTER TABLE invoice_items
    ADD CONSTRAINT fk_invoice_items_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE;

ALTER TABLE invoice_items
    ADD CONSTRAINT fk_invoice_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE SET NULL;

ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    ON DELETE RESTRICT;

ALTER TABLE purchase_order_items
    ADD CONSTRAINT fk_purchase_order_items_order
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
    ON DELETE CASCADE;

ALTER TABLE purchase_order_items
    ADD CONSTRAINT fk_purchase_order_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT;

ALTER TABLE receptions
    ADD CONSTRAINT fk_receptions_purchase_order
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
    ON DELETE RESTRICT;

ALTER TABLE reception_items
    ADD CONSTRAINT fk_reception_items_reception
    FOREIGN KEY (reception_id) REFERENCES receptions(id)
    ON DELETE CASCADE;

ALTER TABLE reception_items
    ADD CONSTRAINT fk_reception_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT;

ALTER TABLE cash_shifts
    ADD CONSTRAINT fk_cash_shifts_register
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id)
    ON DELETE RESTRICT;

ALTER TABLE shift_payments
    ADD CONSTRAINT fk_shift_payments_shift
    FOREIGN KEY (shift_id) REFERENCES cash_shifts(id)
    ON DELETE RESTRICT;
