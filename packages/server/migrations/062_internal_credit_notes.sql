-- ADR-024 (user): annulling an invoice that has no CAE leaves an internal credit note (type INT,
-- status internal) that is never fiscal. The database itself guarantees it, whatever the code:
--   type INT if and only if status internal (null-safe both ways, so no NULL slips through), and
--   an internal note never holds a CAE or an ARCA number.
-- Requires MySQL 8.0.16 or later (CHECK enforced), like migration 044.
-- Reverse: ALTER TABLE credit_notes DROP CHECK chk_credit_notes_internal_never_fiscal
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE credit_notes ADD CONSTRAINT chk_credit_notes_internal_never_fiscal CHECK (
    ((credit_note_type <=> 'INT') = (status <=> 'internal'))
    AND (NOT (credit_note_type <=> 'INT') OR (cae IS NULL AND arca_expected_number IS NULL AND arca_voucher_number IS NULL))
);
