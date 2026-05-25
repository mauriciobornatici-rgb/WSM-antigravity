-- Migration: Add fiscal/AFIP fields to credit_notes table
ALTER TABLE credit_notes
    ADD COLUMN IF NOT EXISTS point_of_sale INT DEFAULT 1 AFTER client_id,
    ADD COLUMN IF NOT EXISTS credit_note_type VARCHAR(10) DEFAULT 'B' AFTER point_of_sale,
    ADD COLUMN IF NOT EXISTS cae VARCHAR(20) NULL AFTER amount,
    ADD COLUMN IF NOT EXISTS cae_expiration_date DATE NULL AFTER cae;
