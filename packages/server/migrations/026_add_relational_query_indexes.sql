-- Secondary indexes for frequent join/filter paths (FK-like columns used by
-- services: order_items by order, invoice_items by invoice, traceability by
-- product/date, POS barcode lookup, audit trail lookups).

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

CREATE INDEX idx_invoices_order ON invoices(order_id);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE INDEX idx_transactions_client ON transactions(client_id);
CREATE INDEX idx_transactions_supplier ON transactions(supplier_id);

CREATE INDEX idx_inventory_movements_product_date ON inventory_movements(product_id, created_at);

CREATE INDEX idx_products_barcode ON products(barcode);

CREATE INDEX idx_serial_numbers_product ON serial_numbers(product_id);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

CREATE INDEX idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_receptions_supplier ON receptions(supplier_id);
CREATE INDEX idx_receptions_purchase_order ON receptions(purchase_order_id);

CREATE INDEX idx_client_returns_client ON client_returns(client_id);
CREATE INDEX idx_credit_notes_client ON credit_notes(client_id);
