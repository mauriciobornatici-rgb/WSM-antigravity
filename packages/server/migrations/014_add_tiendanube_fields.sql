-- Add Tienda Nube sync columns
ALTER TABLE products ADD COLUMN tiendanube_product_id VARCHAR(100) NULL AFTER barcode;
ALTER TABLE products ADD COLUMN tiendanube_variant_id VARCHAR(100) NULL AFTER tiendanube_product_id;
