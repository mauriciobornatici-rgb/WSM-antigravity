-- Add payment status to supplier_invoices
ALTER TABLE supplier_invoices ADD COLUMN payment_status VARCHAR(30) DEFAULT 'pending';

-- Add supplier_invoice_id to supplier_payments
ALTER TABLE supplier_payments ADD COLUMN supplier_invoice_id VARCHAR(36) NULL;

-- Add foreign key constraint to supplier_payments referencing supplier_invoices
ALTER TABLE supplier_payments ADD CONSTRAINT fk_supplier_payments_invoice FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id) ON DELETE SET NULL;
