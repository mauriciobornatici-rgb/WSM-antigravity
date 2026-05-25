-- Create picking_sessions and picking_session_events tables for WMS logistics auditing
-- Add performance indexes for tracking warehouse operations

CREATE TABLE IF NOT EXISTS picking_sessions (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    picker_id VARCHAR(36) NOT NULL,
    status VARCHAR(30) DEFAULT 'in_progress', -- 'in_progress', 'completed'
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    total_items_requested INT DEFAULT 0,
    total_items_picked INT DEFAULT 0,
    INDEX idx_picking_sessions_order (order_id),
    INDEX idx_picking_sessions_picker (picker_id)
);

CREATE TABLE IF NOT EXISTS picking_session_events (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    action_type VARCHAR(50) NOT NULL, -- 'location_verified', 'barcode_scanned', 'quantity_confirmed', 'shortage_closed'
    location_code VARCHAR(100) NULL,
    barcode_scanned VARCHAR(100) NULL,
    quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_picking_events_session (session_id)
);
