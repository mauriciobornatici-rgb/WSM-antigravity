-- Migration 003: Electronic Invoicing System

-- 1. Tax Conditions (Condiciones frente al IVA)
CREATE TABLE IF NOT EXISTS tax_conditions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(50) NOT NULL, -- Responsable Inscripto, Monotributista, Consumidor Final, etc.
    code VARCHAR(10) NOT NULL UNIQUE, -- Código oficial (ej: 1, 6, 5)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial tax conditions
INSERT IGNORE INTO tax_conditions (id, name, code) VALUES 
('tc_RespInscripto', 'Responsable Inscripto', '01'),
('tc_Monotributo', 'Monotributista', '06'),
('tc_ConsFinal', 'Consumidor Final', '05'),
('tc_Exento', 'Exento', '04');

-- 2. Invoices (Cabecera de Factura de Venta)
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(36) PRIMARY KEY,
    
    -- Link to sales order (optional, invoice can be standalone)
    order_id VARCHAR(36),
    
    -- Client Info (Snapshot at moment of invoicing)
    client_id VARCHAR(36),
    client_name VARCHAR(255) NOT NULL,
    client_tax_id VARCHAR(20), -- CUIT/DNI
    client_address TEXT,
    client_tax_condition VARCHAR(50),
    
    -- Invoice Details
    invoice_type CHAR(1) NOT NULL, -- A, B, C, M
    point_of_sale INT NOT NULL, -- Punto de venta (ej: 1)
    invoice_number INT NOT NULL, -- Número correlativo (ej: 1234)
    letter CHAR(1) GENERATED ALWAYS AS (invoice_type) VIRTUAL, -- Redundant but useful
    
    issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATE,
    
    -- Fiscal Data (AFIP)
    cae VARCHAR(50), -- Código de Autorización Electrónico
    cae_expiration_date DATE,
    
    -- Amounts
    net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- Neto Gravado
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- IVA Total
    exempt_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- Exento
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00, -- Total Comprobante
    
    -- Status
    status ENUM('draft', 'issued', 'authorized', 'rejected', 'cancelled') DEFAULT 'draft',
    notes TEXT,
    created_by VARCHAR(36),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    
    UNIQUE KEY unique_invoice_number (invoice_type, point_of_sale, invoice_number),
    INDEX idx_date (issue_date),
    INDEX idx_client (client_id),
    INDEX idx_cae (cae)
);

-- 3. Invoice Items (Detalle)
CREATE TABLE IF NOT EXISTS invoice_items (
    id VARCHAR(36) PRIMARY KEY,
    invoice_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36), -- Optional (could be service or free text)
    
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL, -- Precio unitario SIN IVA
    discount_percentage DECIMAL(5, 2) DEFAULT 0.00,
    
    -- Tax info
    vat_rate DECIMAL(5, 2) NOT NULL, -- 21.00, 10.50, 0.00
    vat_amount DECIMAL(15, 2) NOT NULL, -- Calculated VAT for this line
    
    total_line DECIMAL(15, 2) NOT NULL, -- (Price * Qty) - Discount + VAT
    
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 4. Update Clients table to include tax condition
-- Checking if column exists first is hard in raw SQL without procedure, 
-- but consistent migrations assume state. We'll add if not exists effectively.
-- OR just try to add and ignore error if we had a migration manager.
-- For this simple system, I will attempt to add it.
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_condition_id VARCHAR(36);
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_id VARCHAR(20); -- CUIT/DNI
