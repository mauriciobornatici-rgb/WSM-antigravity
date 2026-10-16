-- AUD-013 (approved by the user, 2026-10-16): the collections and cheques of an invoice are
-- looked up by the invoice. Without these indexes every lookup (and the reissue, which moves
-- them under lock) scans and locks the whole table, blocking every other collection meanwhile.
-- Only indexes: no data changes. MySQL 8 builds them online.
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE customer_check_allocations ADD INDEX idx_check_allocations_invoice (invoice_id);

ALTER TABLE transactions ADD INDEX idx_transactions_reference_type (reference_id, type);
