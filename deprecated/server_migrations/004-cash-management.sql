-- Migration Phase 4: Cash Shifts and Payments

-- Table for physical cash registers
CREATE TABLE IF NOT EXISTS cash_registers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    status ENUM('open', 'closed') DEFAULT 'closed',
    current_shift_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for cash shifts (Apertura/Cierre)
CREATE TABLE IF NOT EXISTS cash_shifts (
    id VARCHAR(36) PRIMARY KEY,
    cash_register_id VARCHAR(36) NOT NULL,
    opened_by VARCHAR(36) NOT NULL,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    
    closed_by VARCHAR(36),
    closed_at TIMESTAMP NULL,
    expected_balance DECIMAL(15, 2) DEFAULT 0, -- Calculated by system
    actual_balance DECIMAL(15, 2) DEFAULT 0,   -- Entered by user
    difference DECIMAL(15, 2) DEFAULT 0,
    
    status ENUM('open', 'closed') DEFAULT 'open',
    notes TEXT,
    
    FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
    FOREIGN KEY (opened_by) REFERENCES users(id),
    FOREIGN KEY (closed_by) REFERENCES users(id)
);

-- Table for detailed payments within a shift
CREATE TABLE IF NOT EXISTS shift_payments (
    id VARCHAR(36) PRIMARY KEY,
    shift_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36),
    payment_method ENUM('cash', 'credit_card', 'debit_card', 'transfer', 'qr', 'credit_account') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    type ENUM('sale', 'refund', 'expense', 'income') DEFAULT 'sale',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (shift_id) REFERENCES cash_shifts(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Insert a default cash register if none exists
INSERT IGNORE INTO cash_registers (id, name, location, status) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Caja Principal', 'Mostrador Central', 'closed');
