CREATE TABLE IF NOT EXISTS supplier_returns (
    id VARCHAR(36) PRIMARY KEY,
    return_number VARCHAR(50) NOT NULL UNIQUE,
    supplier_id VARCHAR(36) NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('draft', 'approved', 'cancelled') DEFAULT 'draft',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    INDEX idx_supplier_returns_supplier (supplier_id),
    INDEX idx_supplier_returns_status (status),
    INDEX idx_supplier_returns_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
    id VARCHAR(36) PRIMARY KEY,
    return_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit_cost DECIMAL(10, 2) NOT NULL,
    reason TEXT,
    FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_supplier_return_items_return (return_id),
    INDEX idx_supplier_return_items_product (product_id)
);
