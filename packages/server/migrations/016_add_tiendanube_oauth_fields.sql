-- Add Tienda Nube OAuth fields
ALTER TABLE company_settings ADD COLUMN tiendanube_client_id VARCHAR(255) NULL AFTER tiendanube_store_id;
ALTER TABLE company_settings ADD COLUMN tiendanube_client_secret VARCHAR(255) NULL AFTER tiendanube_client_id;
