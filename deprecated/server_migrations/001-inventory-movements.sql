-- ==================== INVENTORY MOVEMENTS SYSTEM ====================
-- Tabla principal de movimientos de inventario
CREATE TABLE IF NOT EXISTS inventory_movements (
    id VARCHAR(36) PRIMARY KEY,
    type ENUM('reception', 'sale', 'transfer', 'adjustment', 'return', 'damage') NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    quantity INT NOT NULL,
    unit_cost DECIMAL(10, 2),
    reason VARCHAR(255),
    reference_type ENUM('order', 'reception', 'transfer', 'adjustment', 'manual'),
    reference_id VARCHAR(100),
    notes TEXT,
    performed_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_product (product_id),
    INDEX idx_type (type),
    INDEX idx_created (created_at),
    INDEX idx_reference (reference_type, reference_id)
);

-- Tabla para lotes (productos con vencimiento)
CREATE TABLE IF NOT EXISTS product_batches (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    manufacturing_date DATE,
    expiration_date DATE,
    supplier_id VARCHAR(36),
    reception_id VARCHAR(36),
    quantity_initial INT NOT NULL,
    quantity_current INT NOT NULL,
    location VARCHAR(100),
    status ENUM('active', 'expired', 'recalled', 'depleted') DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    INDEX idx_product (product_id),
    INDEX idx_expiration (expiration_date),
    UNIQUE KEY unique_batch (product_id, batch_number)
);

-- Tabla para números de serie (productos individuales)
CREATE TABLE IF NOT EXISTS serial_numbers (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    serial_number VARCHAR(255) NOT NULL UNIQUE,
    batch_id VARCHAR(36),
    location VARCHAR(100),
    status ENUM('available', 'reserved', 'sold', 'defective', 'returned') DEFAULT 'available',
    
    -- Info de venta
    sold_to_client_id VARCHAR(36),
    sold_in_order_id VARCHAR(36),
    sale_date DATETIME,
    warranty_expiration DATE,
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (batch_id) REFERENCES product_batches(id),
    FOREIGN KEY (sold_to_client_id) REFERENCES clients(id),
    INDEX idx_product (product_id),
    INDEX idx_status (status),
    INDEX idx_serial (serial_number)
);
