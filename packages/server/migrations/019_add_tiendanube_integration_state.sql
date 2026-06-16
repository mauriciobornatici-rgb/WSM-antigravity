-- Tiendanube integration state and idempotency support
ALTER TABLE orders ADD COLUMN external_source VARCHAR(50) NULL AFTER invoice_id;
ALTER TABLE orders ADD COLUMN external_id VARCHAR(100) NULL AFTER external_source;
CREATE INDEX idx_orders_external_ref ON orders (external_source, external_id);

CREATE TABLE IF NOT EXISTS tiendanube_webhook_events (
    id VARCHAR(36) PRIMARY KEY,
    store_id VARCHAR(100) NOT NULL,
    event VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'received',
    payload LONGTEXT NULL,
    error_message TEXT NULL,
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tiendanube_event (store_id, event, resource_id),
    INDEX idx_tiendanube_webhook_status (status),
    INDEX idx_tiendanube_webhook_created_at (created_at)
);
