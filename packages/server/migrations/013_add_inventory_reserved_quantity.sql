-- ============================================================
-- Add reserved_quantity to inventory table for WMS reservations
-- ============================================================

ALTER TABLE inventory ADD COLUMN reserved_quantity INT NOT NULL DEFAULT 0;
