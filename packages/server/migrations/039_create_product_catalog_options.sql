-- Normalized catalog masters used by product creation, editing and reporting.

CREATE TABLE IF NOT EXISTS product_catalog_options (
    id VARCHAR(36) PRIMARY KEY,
    option_key CHAR(64) NOT NULL UNIQUE,
    type VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    normalized_name VARCHAR(100) NOT NULL,
    parent_id VARCHAR(36) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_by VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_catalog_options_type_active (type, active, sort_order, name),
    INDEX idx_catalog_options_parent (parent_id),
    CONSTRAINT fk_catalog_options_parent
        FOREIGN KEY (parent_id) REFERENCES product_catalog_options(id)
        ON DELETE RESTRICT
);

ALTER TABLE products
    ADD COLUMN subcategory VARCHAR(100) NULL AFTER category,
    ADD COLUMN category_option_id VARCHAR(36) NULL AFTER subcategory,
    ADD COLUMN subcategory_option_id VARCHAR(36) NULL AFTER category_option_id,
    ADD COLUMN brand_option_id VARCHAR(36) NULL AFTER brand,
    ADD COLUMN size_option_id VARCHAR(36) NULL AFTER size,
    ADD COLUMN color_option_id VARCHAR(36) NULL AFTER color,
    ADD INDEX idx_products_category_option (category_option_id),
    ADD INDEX idx_products_subcategory_option (subcategory_option_id),
    ADD INDEX idx_products_brand_option (brand_option_id),
    ADD INDEX idx_products_size_option (size_option_id),
    ADD INDEX idx_products_color_option (color_option_id),
    ADD CONSTRAINT fk_products_category_option FOREIGN KEY (category_option_id) REFERENCES product_catalog_options(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_subcategory_option FOREIGN KEY (subcategory_option_id) REFERENCES product_catalog_options(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_brand_option FOREIGN KEY (brand_option_id) REFERENCES product_catalog_options(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_size_option FOREIGN KEY (size_option_id) REFERENCES product_catalog_options(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_color_option FOREIGN KEY (color_option_id) REFERENCES product_catalog_options(id) ON DELETE SET NULL;

INSERT INTO product_catalog_options (id, option_key, type, name, normalized_name)
SELECT UUID(), SHA2(CONCAT('group||', LOWER(TRIM(category))), 256), 'group', MIN(TRIM(category)), LOWER(TRIM(category))
FROM products
WHERE deleted_at IS NULL AND NULLIF(TRIM(category), '') IS NOT NULL
GROUP BY LOWER(TRIM(category))
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO product_catalog_options (id, option_key, type, name, normalized_name)
SELECT UUID(), SHA2(CONCAT('brand||', LOWER(TRIM(brand))), 256), 'brand', MIN(TRIM(brand)), LOWER(TRIM(brand))
FROM products
WHERE deleted_at IS NULL AND NULLIF(TRIM(brand), '') IS NOT NULL
GROUP BY LOWER(TRIM(brand))
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO product_catalog_options (id, option_key, type, name, normalized_name)
SELECT UUID(), SHA2(CONCAT('size||', LOWER(TRIM(size))), 256), 'size', MIN(TRIM(size)), LOWER(TRIM(size))
FROM products
WHERE deleted_at IS NULL AND NULLIF(TRIM(size), '') IS NOT NULL
GROUP BY LOWER(TRIM(size))
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO product_catalog_options (id, option_key, type, name, normalized_name)
SELECT UUID(), SHA2(CONCAT('color||', LOWER(TRIM(color))), 256), 'color', MIN(TRIM(color)), LOWER(TRIM(color))
FROM products
WHERE deleted_at IS NULL AND NULLIF(TRIM(color), '') IS NOT NULL
GROUP BY LOWER(TRIM(color))
ON DUPLICATE KEY UPDATE name = VALUES(name);

UPDATE products product
JOIN product_catalog_options catalog_option
  ON catalog_option.type = 'group' AND catalog_option.normalized_name = LOWER(TRIM(product.category))
SET product.category_option_id = catalog_option.id
WHERE product.category_option_id IS NULL AND NULLIF(TRIM(product.category), '') IS NOT NULL;

UPDATE products product
JOIN product_catalog_options catalog_option
  ON catalog_option.type = 'brand' AND catalog_option.normalized_name = LOWER(TRIM(product.brand))
SET product.brand_option_id = catalog_option.id
WHERE product.brand_option_id IS NULL AND NULLIF(TRIM(product.brand), '') IS NOT NULL;

UPDATE products product
JOIN product_catalog_options catalog_option
  ON catalog_option.type = 'size' AND catalog_option.normalized_name = LOWER(TRIM(product.size))
SET product.size_option_id = catalog_option.id
WHERE product.size_option_id IS NULL AND NULLIF(TRIM(product.size), '') IS NOT NULL;

UPDATE products product
JOIN product_catalog_options catalog_option
  ON catalog_option.type = 'color' AND catalog_option.normalized_name = LOWER(TRIM(product.color))
SET product.color_option_id = catalog_option.id
WHERE product.color_option_id IS NULL AND NULLIF(TRIM(product.color), '') IS NOT NULL;
