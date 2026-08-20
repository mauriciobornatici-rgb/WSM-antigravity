-- A resource can legitimately emit the same webhook event many times over its
-- lifecycle (for example order/updated). Processing is idempotent at entity level.
ALTER TABLE tiendanube_webhook_events DROP INDEX uq_tiendanube_event;

CREATE INDEX idx_tiendanube_event_resource
    ON tiendanube_webhook_events (store_id, event, resource_id, created_at);
