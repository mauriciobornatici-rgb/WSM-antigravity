-- ADR-019 / AUD-007: orders whose stock is tracked by allocations (every order reserved since
-- allocations exist), retries with backoff for the online-store stock, and the index the
-- stock reconciliation reads every few seconds.
-- (No semicolons in comments: the migration runner splits statements on them.)

-- An order that reserves through allocations never falls back to the legacy "release any
-- reservation of the product" path, even when it could reserve nothing (an online order
-- without stock): that path would free other orders' reservations.
ALTER TABLE orders ADD COLUMN allocation_tracked TINYINT(1) NOT NULL DEFAULT 0;

UPDATE orders o SET o.allocation_tracked = 1
WHERE EXISTS (SELECT 1 FROM order_item_allocations a WHERE a.order_id = o.id);

-- The stock sync remembers failures: a product that keeps failing waits longer each time
-- instead of being retried every few seconds.
ALTER TABLE tiendanube_stock_state MODIFY COLUMN pushed_stock INT NULL;
ALTER TABLE tiendanube_stock_state ADD COLUMN error_count INT NOT NULL DEFAULT 0;
ALTER TABLE tiendanube_stock_state ADD COLUMN last_error_at DATETIME NULL;
ALTER TABLE tiendanube_stock_state ADD COLUMN variant_id VARCHAR(100) NULL;

ALTER TABLE inventory ADD INDEX idx_inventory_updated_at (updated_at);
