-- Hardening Version 2: Traceability & Data Preservation

-- 1. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NULL,
    action VARCHAR(100) NOT NULL, -- e.g. 'CREATE', 'UPDATE', 'DELETE', 'LOGIN'
    entity_type VARCHAR(50) NOT NULL, -- e.g. 'product', 'order', 'client'
    entity_id VARCHAR(36) NULL,
    old_values JSON NULL,
    new_values JSON NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. SOFT DELETES (deleted_at Column)
-- We add this to all major business entities

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- 3. INDICES FOR SOFT DELETES
CREATE INDEX idx_products_deleted ON products(deleted_at);
CREATE INDEX idx_clients_deleted ON clients(deleted_at);
CREATE INDEX idx_orders_deleted ON orders(deleted_at);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- 4. UPDATE USER STATUS TO SOFT DELETE COMPATIBLE
-- We keep 'status' for manual activation/deactivation, but use deleted_at for removal.
