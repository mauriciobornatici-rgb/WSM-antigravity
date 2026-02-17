-- ==================== PURCHASE ORDERS & RECEPTION SYSTEM ====================

-- Órdenes de Compra
CREATE TABLE IF NOT EXISTS purchase_orders (
    id VARCHAR(36) PRIMARY KEY,
    po_number VARCHAR(100) UNIQUE NOT NULL,
    supplier_id VARCHAR(36) NOT NULL,
    order_date DATE NOT NULL,
    expected_delivery_date DATE,
    status ENUM('draft', 'sent', 'partial', 'received', 'cancelled') DEFAULT 'draft',
    subtotal DECIMAL(15, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    notes TEXT,
    created_by VARCHAR(36),
    approved_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    INDEX idx_supplier (supplier_id),
    INDEX idx_status (status),
    INDEX idx_po_number (po_number)
);

-- Items de Órdenes de Compra
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id VARCHAR(36) PRIMARY KEY,
    purchase_order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity_ordered INT NOT NULL,
    quantity_received INT DEFAULT 0,
    unit_cost DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(15, 2) GENERATED ALWAYS AS (quantity_ordered * unit_cost) STORED,
    
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_po (purchase_order_id),
    INDEX idx_product (product_id)
);

-- Recepciones de Mercadería
CREATE TABLE IF NOT EXISTS receptions (
    id VARCHAR(36) PRIMARY KEY,
    reception_number VARCHAR(100) UNIQUE NOT NULL,
    purchase_order_id VARCHAR(36),
    supplier_id VARCHAR(36) NOT NULL,
    reception_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    remito_number VARCHAR(100),
    status ENUM('pending_qc', 'approved', 'partially_approved', 'rejected') DEFAULT 'pending_qc',
    received_by VARCHAR(36),
    approved_by VARCHAR(36),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    INDEX idx_po (purchase_order_id),
    INDEX idx_supplier (supplier_id),
    INDEX idx_status (status),
    INDEX idx_reception_number (reception_number)
);

-- Items de Recepción
CREATE TABLE IF NOT EXISTS reception_items (
    id VARCHAR(36) PRIMARY KEY,
    reception_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    po_item_id VARCHAR(36),
    quantity_expected INT,
    quantity_received INT NOT NULL,
    quantity_approved INT DEFAULT 0,
    quantity_rejected INT DEFAULT 0,
    rejection_reason TEXT,
    location_assigned VARCHAR(100),
    batch_number VARCHAR(100),
    expiration_date DATE,
    unit_cost DECIMAL(10, 2),
    notes TEXT,
    
    FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (po_item_id) REFERENCES purchase_order_items(id),
    INDEX idx_reception (reception_id),
    INDEX idx_product (product_id)
);

-- Control de Calidad
CREATE TABLE IF NOT EXISTS quality_checks (
    id VARCHAR(36) PRIMARY KEY,
    reception_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    inspector_id VARCHAR(36),
    check_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    result ENUM('pass', 'fail', 'conditional') NOT NULL,
    quantity_checked INT,
    quantity_passed INT,
    quantity_failed INT,
    defect_description TEXT,
    photos JSON,
    action_taken ENUM('approve', 'reject', 'return_to_supplier', 'discount') DEFAULT 'approve',
    notes TEXT,
    
    FOREIGN KEY (reception_id) REFERENCES receptions(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_reception (reception_id),
    INDEX idx_result (result)
);
