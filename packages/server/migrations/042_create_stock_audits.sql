-- Controlled cycle counts: blind counting, ABC scope and traceable stock adjustments.

CREATE TABLE IF NOT EXISTS stock_audit_sessions (
    id VARCHAR(36) PRIMARY KEY,
    audit_number VARCHAR(40) NOT NULL UNIQUE,
    location_code VARCHAR(100) NOT NULL,
    abc_class VARCHAR(3) NOT NULL DEFAULT 'ALL',
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    blind_count BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NULL,
    created_by VARCHAR(36) NULL,
    adjusted_by VARCHAR(36) NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    adjusted_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_stock_audits_status_started (status, started_at),
    INDEX idx_stock_audits_location (location_code, status),
    INDEX idx_stock_audits_abc (abc_class, status)
);

CREATE TABLE IF NOT EXISTS stock_audit_items (
    id VARCHAR(36) PRIMARY KEY,
    audit_id VARCHAR(36) NOT NULL,
    inventory_id VARCHAR(36) NULL,
    product_id VARCHAR(36) NOT NULL,
    location_code VARCHAR(100) NOT NULL,
    abc_class CHAR(1) NOT NULL,
    expected_quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    counted_quantity DECIMAL(15,3) NULL,
    variance DECIMAL(15,3) NULL,
    is_unexpected BOOLEAN NOT NULL DEFAULT FALSE,
    notes VARCHAR(500) NULL,
    counted_by VARCHAR(36) NULL,
    counted_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_stock_audit_product_location (audit_id, product_id, location_code),
    INDEX idx_stock_audit_items_pending (audit_id, counted_at),
    INDEX idx_stock_audit_items_product (product_id, location_code)
);

CREATE TABLE IF NOT EXISTS stock_audit_count_events (
    id VARCHAR(36) PRIMARY KEY,
    audit_id VARCHAR(36) NOT NULL,
    audit_item_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    previous_counted_quantity DECIMAL(15,3) NULL,
    counted_quantity DECIMAL(15,3) NOT NULL,
    performed_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_audit_events_audit (audit_id, created_at),
    INDEX idx_stock_audit_events_item (audit_item_id, created_at)
);
