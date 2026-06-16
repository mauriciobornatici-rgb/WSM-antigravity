-- Create failed_syncs table for Tienda Nube stock sync failures
CREATE TABLE IF NOT EXISTS failed_syncs (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    tiendanube_product_id VARCHAR(100) NOT NULL,
    tiendanube_variant_id VARCHAR(100) NOT NULL,
    stock INT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    last_error TEXT NULL,
    last_attempt_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_failed_sync (product_id, tiendanube_variant_id),
    INDEX idx_failed_syncs_status (status),
    INDEX idx_failed_syncs_created_at (created_at)
);
