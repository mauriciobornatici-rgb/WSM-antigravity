-- Idempotent manual credit notes (ADR-012): a retry carrying the same key returns the
-- note already issued instead of issuing a second one with a new number.
ALTER TABLE credit_notes ADD COLUMN idempotency_key VARCHAR(64) NULL;

ALTER TABLE credit_notes ADD UNIQUE KEY uq_credit_notes_idempotency_key (idempotency_key);
