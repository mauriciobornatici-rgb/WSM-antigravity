-- Exact per-order inventory reservations and concurrency-safe picking sessions.

CREATE TABLE IF NOT EXISTS order_item_allocations (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    order_item_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    inventory_id VARCHAR(36) NOT NULL,
    location_code VARCHAR(100) NOT NULL,
    reserved_quantity INT NOT NULL,
    picked_quantity INT NOT NULL DEFAULT 0,
    shortage_quantity INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'reserved',
    version INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_order_item_allocation_inventory (order_item_id, inventory_id),
    INDEX idx_order_allocations_order_status (order_id, status),
    INDEX idx_order_allocations_route (order_id, location_code, product_id),
    INDEX idx_order_allocations_inventory (inventory_id),
    CONSTRAINT fk_order_allocations_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_allocations_item
        FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_allocations_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_order_allocations_inventory
        FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT,
    CONSTRAINT chk_order_allocations_quantities
        CHECK (
            reserved_quantity > 0
            AND picked_quantity >= 0
            AND shortage_quantity >= 0
            AND picked_quantity + shortage_quantity <= reserved_quantity
        )
);

ALTER TABLE picking_sessions
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0 AFTER total_items_picked,
    ADD COLUMN IF NOT EXISTS claim_idempotency_key VARCHAR(100) NULL AFTER version,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP NULL AFTER claim_idempotency_key,
    ADD COLUMN IF NOT EXISTS released_at TIMESTAMP NULL AFTER completed_at,
    ADD COLUMN IF NOT EXISTS release_reason VARCHAR(255) NULL AFTER released_at,
    ADD COLUMN IF NOT EXISTS completed_with_shortage BOOLEAN NOT NULL DEFAULT FALSE AFTER release_reason,
    ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP NULL AFTER completed_with_shortage;

UPDATE picking_sessions
SET claimed_at = COALESCE(claimed_at, started_at),
    last_activity_at = COALESCE(last_activity_at, completed_at, started_at)
WHERE claimed_at IS NULL OR last_activity_at IS NULL;

ALTER TABLE picking_sessions
    ADD UNIQUE KEY uq_picking_sessions_claim_idempotency (claim_idempotency_key);

ALTER TABLE picking_session_events
    MODIFY COLUMN product_id VARCHAR(36) NULL,
    ADD COLUMN IF NOT EXISTS allocation_id VARCHAR(36) NULL AFTER product_id,
    ADD COLUMN IF NOT EXISTS order_item_id VARCHAR(36) NULL AFTER allocation_id,
    ADD COLUMN IF NOT EXISTS picker_id VARCHAR(36) NULL AFTER order_item_id,
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) NULL AFTER picker_id,
    ADD COLUMN IF NOT EXISTS session_version INT NULL AFTER idempotency_key,
    ADD COLUMN IF NOT EXISTS reason VARCHAR(255) NULL AFTER quantity;

ALTER TABLE picking_session_events
    ADD UNIQUE KEY uq_picking_events_session_idempotency (session_id, idempotency_key),
    ADD INDEX idx_picking_events_allocation (allocation_id, created_at),
    ADD INDEX idx_picking_events_picker (picker_id, created_at),
    ADD CONSTRAINT fk_picking_events_allocation
        FOREIGN KEY (allocation_id) REFERENCES order_item_allocations(id) ON DELETE SET NULL;
