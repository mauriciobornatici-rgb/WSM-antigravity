-- Migration 008: Add product granular VAT rate
ALTER TABLE products ADD COLUMN vat_rate DECIMAL(5,2) NOT NULL DEFAULT 21.00;
