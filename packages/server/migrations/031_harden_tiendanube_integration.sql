-- Tiendanube integration correctness and multi-location support.
ALTER TABLE company_settings
    ADD COLUMN tiendanube_location_id VARCHAR(100) NULL AFTER tiendanube_store_id;

-- MySQL allows multiple NULL pairs while preventing duplicate imported orders.
ALTER TABLE orders
    ADD UNIQUE KEY uq_orders_external_ref (external_source, external_id);

ALTER TABLE tiendanube_webhook_events
    ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER status;

ALTER TABLE tiendanube_webhook_events
    ADD COLUMN max_attempts INT NOT NULL DEFAULT 16 AFTER attempts;

ALTER TABLE tiendanube_webhook_events
    ADD COLUMN next_attempt_at TIMESTAMP NULL AFTER error_message;
