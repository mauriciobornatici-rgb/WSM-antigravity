ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS counter_user_id VARCHAR(36) NULL AFTER client_id,
    ADD COLUMN IF NOT EXISTS counter_name VARCHAR(255) NULL AFTER customer_name,
    ADD COLUMN IF NOT EXISTS notes TEXT NULL AFTER delivery_notes;
