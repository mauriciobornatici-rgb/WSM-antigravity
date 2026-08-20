ALTER TABLE picking_sessions
    ADD COLUMN IF NOT EXISTS active_order_id VARCHAR(36)
    GENERATED ALWAYS AS (CASE WHEN status = 'in_progress' THEN order_id ELSE NULL END) STORED;

ALTER TABLE picking_sessions
    ADD UNIQUE KEY uq_picking_sessions_one_active_order (active_order_id);
