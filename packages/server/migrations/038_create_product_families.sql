CREATE TABLE IF NOT EXISTS product_families (
    id VARCHAR(36) PRIMARY KEY,
    family_key CHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    brand VARCHAR(100) NULL,
    category VARCHAR(100) NULL,
    image_url TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uq_product_families_key (family_key),
    INDEX idx_product_families_name (name),
    INDEX idx_product_families_category (category)
);

ALTER TABLE products
    ADD COLUMN family_id VARCHAR(36) NULL AFTER id,
    ADD INDEX idx_products_family (family_id),
    ADD CONSTRAINT fk_products_family
        FOREIGN KEY (family_id) REFERENCES product_families(id)
        ON DELETE SET NULL;

INSERT INTO product_families (id, family_key, name, description, brand, category)
SELECT
    UUID(),
    SHA2(CONCAT('tiendanube|', family.id), 256),
    family.name,
    family.description,
    family.brand,
    family.category
FROM tiendanube_catalog_families family
WHERE family.deleted_at IS NULL
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    brand = VALUES(brand),
    category = VALUES(category);

UPDATE products product
JOIN tiendanube_catalog_variants remote_variant ON remote_variant.product_id = product.id
JOIN product_families family ON family.family_key = SHA2(CONCAT('tiendanube|', remote_variant.family_id), 256)
SET product.family_id = family.id
WHERE product.family_id IS NULL;

INSERT INTO product_families (id, family_key, name, brand, category, image_url)
SELECT
    UUID(),
    SHA2(CONCAT(
        'attributes|',
        LOWER(TRIM(product.name)), '|',
        LOWER(TRIM(COALESCE(product.brand, ''))), '|',
        LOWER(TRIM(COALESCE(product.category, '')))
    ), 256),
    MIN(product.name),
    MIN(NULLIF(TRIM(product.brand), '')),
    MIN(NULLIF(TRIM(product.category), '')),
    MIN(NULLIF(TRIM(product.image_url), ''))
FROM products product
WHERE product.deleted_at IS NULL
  AND product.family_id IS NULL
  AND (NULLIF(TRIM(product.size), '') IS NOT NULL OR NULLIF(TRIM(product.color), '') IS NOT NULL)
GROUP BY SHA2(CONCAT(
    'attributes|',
    LOWER(TRIM(product.name)), '|',
    LOWER(TRIM(COALESCE(product.brand, ''))), '|',
    LOWER(TRIM(COALESCE(product.category, '')))
), 256)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    brand = VALUES(brand),
    category = VALUES(category),
    image_url = COALESCE(product_families.image_url, VALUES(image_url));

UPDATE products product
JOIN product_families family ON family.family_key = SHA2(CONCAT(
    'attributes|',
    LOWER(TRIM(product.name)), '|',
    LOWER(TRIM(COALESCE(product.brand, ''))), '|',
    LOWER(TRIM(COALESCE(product.category, '')))
), 256)
SET product.family_id = family.id
WHERE product.family_id IS NULL
  AND product.deleted_at IS NULL
  AND (NULLIF(TRIM(product.size), '') IS NOT NULL OR NULLIF(TRIM(product.color), '') IS NOT NULL);
