-- ADR-022: an invoice ARCA never authorized (rejected, or a Factura A without the customer's
-- CUIT) is annulled and issued again with the right letter or customer. The new invoice keeps
-- the link to the one it replaces. The old one stays as a record (status cancelled, soft
-- deleted, its ledger entries reversed) with the label it had when annulled: its provisional
-- number may still move later if ARCA gives that number to another invoice (AUD-010).
-- Reverse: DROP INDEX then DROP COLUMN (both columns).
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE invoices ADD COLUMN replaces_invoice_id VARCHAR(36) NULL;
ALTER TABLE invoices ADD INDEX idx_invoices_replaces (replaces_invoice_id);
ALTER TABLE invoices ADD COLUMN annulled_label VARCHAR(30) NULL;
