-- Create supplier_returns table
CREATE TABLE IF NOT EXISTS supplier_returns (
    id VARCHAR(36) PRIMARY KEY,
    return_number VARCHAR(50) NOT NULL UNIQUE,
    supplier_id VARCHAR(36) NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('draft', 'approved', 'cancelled') DEFAULT 'draft',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- Create supplier_return_items table
CREATE TABLE IF NOT EXISTS supplier_return_items (
    id VARCHAR(36) PRIMARY KEY,
    return_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit_cost DECIMAL(10, 2) NOT NULL,
    reason TEXT,
    FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Display success message (compatible with mysql client if run directly, though index.js might not capture it the same way)
SELECT 'Tables for Returns created successfully' as msg;
