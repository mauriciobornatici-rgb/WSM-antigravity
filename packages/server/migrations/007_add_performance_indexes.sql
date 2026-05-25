-- Performance Optimization Indexes
-- Add composite and single indexes for the most queried tables to support massive pagination and filtering


CREATE INDEX idx_orders_status_client ON orders(status, client_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);

CREATE INDEX idx_invoices_status ON invoices(status, payment_status);

CREATE INDEX idx_transactions_type_date ON transactions(type, date);
