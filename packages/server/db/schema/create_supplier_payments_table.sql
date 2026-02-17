-- Create supplier_payments table if it doesn't exist
CREATE TABLE IF NOT EXISTS supplier_payments (
    id VARCHAR(36) PRIMARY KEY,
    supplier_id VARCHAR(36) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50),
    reference_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    INDEX idx_supplier_id (supplier_id),
    INDEX idx_payment_date (payment_date)
);

-- Display message
SELECT 'Table supplier_payments created successfully' AS status;
