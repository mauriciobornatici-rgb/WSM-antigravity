-- Add Tienda Nube configurations
ALTER TABLE company_settings ADD COLUMN tiendanube_access_token VARCHAR(255) NULL AFTER billing_afip_env;
ALTER TABLE company_settings ADD COLUMN tiendanube_store_id VARCHAR(100) NULL AFTER tiendanube_access_token;

ALTER TABLE products ADD COLUMN tiendanube_sync_enabled BOOLEAN DEFAULT false AFTER tiendanube_variant_id;
