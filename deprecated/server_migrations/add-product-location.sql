-- Add location column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS location VARCHAR(100) AFTER image_url;
