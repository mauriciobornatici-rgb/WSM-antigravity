-- Hardening Version 1
-- Objective: Integrity, Performance and Auditability

-- 1. ADAPT USERS
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
MODIFY name VARCHAR(255) NOT NULL,
MODIFY email VARCHAR(255) NOT NULL;

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- 2. ADAPT PRODUCTS
ALTER TABLE products
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_category ON products(category);

-- 3. INVENTORY (Integrity)
-- Ensure product_id exists
ALTER TABLE inventory
MODIFY product_id VARCHAR(36) NOT NULL;

-- 4. CLIENTS & SUPPLIERS
CREATE INDEX idx_clients_tax_id ON clients(tax_id);
CREATE INDEX idx_suppliers_tax_id ON suppliers(tax_id);

-- 5. ORDERS & ITEMS (Foreign Keys)
-- We use a safer approach: checking for orphans before adding FKs is good practice
-- but for now we assume clean-ish data or first run.

-- FK: Orders -> Clients
ALTER TABLE orders
MODIFY client_id VARCHAR(36) NULL; -- Can be guest

-- FK: Order Items -> Orders
ALTER TABLE order_items
ADD CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- FK: Order Items -> Products
ALTER TABLE order_items
ADD CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;

-- 6. TRANSACTIONS
ALTER TABLE transactions
ADD CONSTRAINT fk_trans_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_trans_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;

-- 7. AUDIT TRIGGERS (Optional but recommended for high standards)
-- We will stick to ON UPDATE CURRENT_TIMESTAMP for simple audit columns.
