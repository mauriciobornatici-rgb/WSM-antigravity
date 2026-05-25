-- Migration: Add AFIP / ARCA Electronic Invoicing Settings columns
ALTER TABLE company_settings
ADD COLUMN billing_iibb VARCHAR(100) NULL,
ADD COLUMN billing_start_date VARCHAR(50) NULL,
ADD COLUMN billing_iva_condition VARCHAR(100) NULL,
ADD COLUMN billing_pos INT NULL,
ADD COLUMN billing_afip_crt TEXT NULL,
ADD COLUMN billing_afip_key TEXT NULL,
ADD COLUMN billing_afip_env VARCHAR(50) DEFAULT 'homologacion';
