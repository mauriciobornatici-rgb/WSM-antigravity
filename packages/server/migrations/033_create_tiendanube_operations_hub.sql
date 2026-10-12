-- Dedicated Tiendanube operations model: catalog families/variants, customers,
-- enriched orders, multi-shipment fulfillment and synchronization history.
ALTER TABLE company_settings
    ADD COLUMN tiendanube_connection_status VARCHAR(30) NOT NULL DEFAULT 'disconnected' AFTER tiendanube_location_id;

CREATE TABLE IF NOT EXISTS tiendanube_catalog_families (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    brand VARCHAR(100) NULL,
    category VARCHAR(100) NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'hidden',
    remote_product_id VARCHAR(100) NULL,
    sync_status VARCHAR(30) NOT NULL DEFAULT 'local_only',
    last_error TEXT NULL,
    remote_updated_at DATETIME NULL,
    last_synced_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uq_tn_family_remote_product (remote_product_id),
    INDEX idx_tn_family_status (sync_status, visibility),
    INDEX idx_tn_family_name (name)
);

CREATE TABLE IF NOT EXISTS tiendanube_catalog_variants (
    id VARCHAR(36) PRIMARY KEY,
    family_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    remote_variant_id VARCHAR(100) NULL,
    sync_status VARCHAR(30) NOT NULL DEFAULT 'local_only',
    last_error TEXT NULL,
    last_synced_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tn_variant_product (product_id),
    UNIQUE KEY uq_tn_variant_remote (remote_variant_id),
    INDEX idx_tn_variant_family (family_id),
    CONSTRAINT fk_tn_variant_family FOREIGN KEY (family_id) REFERENCES tiendanube_catalog_families(id) ON DELETE CASCADE,
    CONSTRAINT fk_tn_variant_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tiendanube_customers (
    external_id VARCHAR(100) PRIMARY KEY,
    local_client_id VARCHAR(36) NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(100) NULL,
    identification VARCHAR(100) NULL,
    default_address JSON NULL,
    total_spent DECIMAL(15,2) NOT NULL DEFAULT 0,
    orders_count INT NOT NULL DEFAULT 0,
    remote_payload JSON NULL,
    last_synced_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tn_customer_email (email),
    INDEX idx_tn_customer_name (name),
    CONSTRAINT fk_tn_customer_local FOREIGN KEY (local_client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tiendanube_order_details (
    order_id VARCHAR(36) PRIMARY KEY,
    external_number VARCHAR(100) NULL,
    customer_external_id VARCHAR(100) NULL,
    contact_email VARCHAR(255) NULL,
    contact_phone VARCHAR(100) NULL,
    contact_identification VARCHAR(100) NULL,
    remote_status VARCHAR(30) NULL,
    remote_payment_status VARCHAR(30) NULL,
    remote_shipping_status VARCHAR(30) NULL,
    gateway VARCHAR(100) NULL,
    gateway_name VARCHAR(255) NULL,
    shipping_address JSON NULL,
    billing_address JSON NULL,
    remote_payload JSON NULL,
    remote_created_at DATETIME NULL,
    remote_updated_at DATETIME NULL,
    last_synced_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tn_order_number (external_number),
    INDEX idx_tn_order_customer (customer_external_id),
    INDEX idx_tn_order_states (remote_payment_status, remote_shipping_status),
    CONSTRAINT fk_tn_order_details_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tiendanube_fulfillments (
    id VARCHAR(100) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    external_order_id VARCHAR(100) NOT NULL,
    number VARCHAR(100) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'UNPACKED',
    assigned_location_id VARCHAR(100) NULL,
    recipient JSON NULL,
    destination JSON NULL,
    shipping JSON NULL,
    tracking_info JSON NULL,
    tracking_events JSON NULL,
    fulfilled_at DATETIME NULL,
    remote_payload JSON NULL,
    remote_created_at DATETIME NULL,
    remote_updated_at DATETIME NULL,
    last_synced_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tn_fulfillment_order (order_id),
    INDEX idx_tn_fulfillment_status (status),
    CONSTRAINT fk_tn_fulfillment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tiendanube_sync_runs (
    id VARCHAR(36) PRIMARY KEY,
    operation VARCHAR(60) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    processed_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    failure_count INT NOT NULL DEFAULT 0,
    details JSON NULL,
    started_by VARCHAR(36) NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tn_sync_runs_created (created_at),
    INDEX idx_tn_sync_runs_status (status)
);
