CREATE TABLE IF NOT EXISTS outgoing_checks (
    id VARCHAR(36) PRIMARY KEY,
    supplier_id VARCHAR(36) NOT NULL,
    source_type VARCHAR(20) NOT NULL DEFAULT 'own',
    source_customer_check_id VARCHAR(36) NULL,
    issuer_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    check_number VARCHAR(100) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    issue_date DATE NULL,
    due_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'delivered',
    delivered_at DATETIME NULL,
    cleared_at DATETIME NULL,
    notes TEXT NULL,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_outgoing_check_bank_number (bank_name, check_number),
    INDEX idx_outgoing_checks_status_due (status, due_date),
    INDEX idx_outgoing_checks_supplier (supplier_id),
    INDEX idx_outgoing_checks_source (source_customer_check_id)
);

CREATE TABLE IF NOT EXISTS outgoing_check_events (
    id VARCHAR(36) PRIMARY KEY,
    check_id VARCHAR(36) NOT NULL,
    status VARCHAR(30) NOT NULL,
    notes TEXT NULL,
    performed_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_outgoing_check_events_check (check_id, created_at)
);

CREATE TABLE IF NOT EXISTS outgoing_check_allocations (
    id VARCHAR(36) PRIMARY KEY,
    check_id VARCHAR(36) NOT NULL,
    supplier_payment_id VARCHAR(36) NOT NULL,
    supplier_invoice_id VARCHAR(36) NULL,
    amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_outgoing_check_payment (supplier_payment_id),
    INDEX idx_outgoing_check_allocations_check (check_id)
);

ALTER TABLE supplier_payments ADD COLUMN outgoing_check_id VARCHAR(36) NULL AFTER reference_number;
ALTER TABLE supplier_payments ADD INDEX idx_supplier_payments_outgoing_check (outgoing_check_id);
