-- Historical development databases may predate the canonical products.brand
-- column even when the bootstrap migration is already recorded.
ALTER TABLE products
    ADD COLUMN brand VARCHAR(100) NULL AFTER location;
