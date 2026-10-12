-- ADR-015 (usuario, 2026-10-12):
-- "Caja 2": treasury cash kept outside the POS drawer, used to pay suppliers.
INSERT IGNORE INTO chart_of_accounts (code, name, type)
VALUES ('1.1.01.02', 'Caja 2 (tesorería)', 'asset');

-- One row per idempotent request: the first attempt inserts it (primary key), a retry
-- collides and replays the stored response instead of paying twice.
CREATE TABLE IF NOT EXISTS idempotency_requests (
    scope VARCHAR(50) NOT NULL,
    idem_key VARCHAR(64) NOT NULL,
    request_hash VARCHAR(64) NULL,
    response_json JSON NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, idem_key)
);

-- Sales-floor locations: the counter (POS) sells from them first, orders are picked from
-- the back (warehouse) first. (No semicolons in comments: the runner splits on them.)
ALTER TABLE warehouse_locations ADD COLUMN is_sales_floor TINYINT(1) NOT NULL DEFAULT 0;
