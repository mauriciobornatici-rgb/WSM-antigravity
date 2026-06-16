-- Create supplier_invoices table for purchasing financial and tax record keeping
CREATE TABLE IF NOT EXISTS supplier_invoices (
    id VARCHAR(36) PRIMARY KEY,
    invoice_number VARCHAR(100) NOT NULL, -- Ej: '0001-00012345'
    invoice_type VARCHAR(10) NOT NULL, -- 'A', 'B', 'C', 'M'
    supplier_id VARCHAR(36) NOT NULL,
    reception_id VARCHAR(36) NULL, -- Vínculo opcional a Remito (recepción de mercadería)
    purchase_order_id VARCHAR(36) NULL, -- Vínculo opcional a Orden de Compra
    issue_date DATE NOT NULL,
    due_date DATE NULL,
    net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- Neto Gravado
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- IVA Crédito Fiscal
    other_taxes DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- Percepciones (IIBB/Ganancias/etc)
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- Total Facturado (deuda total)
    status VARCHAR(30) DEFAULT 'approved', -- 'draft', 'approved', 'cancelled'
    notes TEXT NULL,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE SET NULL,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
    UNIQUE KEY uq_supplier_invoice (supplier_id, invoice_type, invoice_number)
);
