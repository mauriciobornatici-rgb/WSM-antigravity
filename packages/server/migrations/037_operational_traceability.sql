-- Persistent warehouse location master, mixed order payments and cheque portfolio.

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO warehouse_locations (id, code, name, description, active)
SELECT UUID(), locations.location, locations.location, 'Importada desde existencias actuales', TRUE
FROM (
    SELECT DISTINCT location FROM inventory WHERE location IS NOT NULL AND TRIM(location) <> ''
    UNION
    SELECT DISTINCT location FROM products WHERE location IS NOT NULL AND TRIM(location) <> ''
) AS locations;

INSERT IGNORE INTO warehouse_locations (id, code, name, description, active) VALUES
(UUID(), 'General', 'Depósito general', 'Ubicación predeterminada', TRUE),
(UUID(), 'Cuarentena', 'Cuarentena', 'Mercadería pendiente o rechazada por calidad', TRUE),
(UUID(), 'Devoluciones a Proveedores', 'Devoluciones a proveedores', 'Mercadería separada para RMA', TRUE),
(UUID(), 'Mermas', 'Mermas', 'Mercadería no comercializable', TRUE);

CREATE TABLE IF NOT EXISTS order_payments (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    check_payload JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_payments_order (order_id)
);

CREATE TABLE IF NOT EXISTS customer_checks (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NULL,
    issuer_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    check_number VARCHAR(100) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    issue_date DATE NULL,
    due_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'received',
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deposited_at DATETIME NULL,
    cleared_at DATETIME NULL,
    delivered_to VARCHAR(255) NULL,
    notes TEXT NULL,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_customer_check_bank_number (bank_name, check_number),
    INDEX idx_customer_checks_status_due (status, due_date),
    INDEX idx_customer_checks_client (client_id)
);

CREATE TABLE IF NOT EXISTS customer_check_events (
    id VARCHAR(36) PRIMARY KEY,
    check_id VARCHAR(36) NOT NULL,
    status VARCHAR(30) NOT NULL,
    notes TEXT NULL,
    performed_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_customer_check_events_check (check_id, created_at)
);

CREATE TABLE IF NOT EXISTS customer_check_allocations (
    id VARCHAR(36) PRIMARY KEY,
    check_id VARCHAR(36) NOT NULL,
    transaction_id VARCHAR(36) NOT NULL,
    invoice_id VARCHAR(36) NULL,
    amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_check_allocation_transaction (transaction_id),
    INDEX idx_check_allocations_check (check_id)
);

ALTER TABLE transactions ADD COLUMN payment_method VARCHAR(50) NULL AFTER description;
ALTER TABLE transactions ADD COLUMN check_id VARCHAR(36) NULL AFTER payment_method;
ALTER TABLE transactions ADD INDEX idx_transactions_check (check_id);

INSERT IGNORE INTO chart_of_accounts (code, name, type)
VALUES ('1.1.02.02', 'Valores a Depositar - Cheques', 'asset');
