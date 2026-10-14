-- ADR-022: an invoice ARCA never authorized (rejected, or a Factura A without the customer's
-- CUIT) is annulled and issued again with the right letter or customer. The new invoice keeps
-- the link to the one it replaces. The old one stays as a record (status cancelled, soft
-- deleted, its ledger entries reversed) with the label it had when annulled: its provisional
-- number may still move later if ARCA gives that number to another invoice (AUD-010).
-- arca_configured_at: when the ARCA credentials were first complete. The "no CAE after 24 h"
-- alert counts only invoices issued since then (user decision). A company already configured
-- starts counting now.
-- Reverse: DROP INDEX then DROP COLUMN (the three columns).
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE invoices ADD COLUMN replaces_invoice_id VARCHAR(36) NULL;
ALTER TABLE invoices ADD INDEX idx_invoices_replaces (replaces_invoice_id);
ALTER TABLE invoices ADD COLUMN annulled_label VARCHAR(30) NULL;
ALTER TABLE company_settings ADD COLUMN arca_configured_at DATETIME NULL;
UPDATE company_settings SET arca_configured_at = NOW() WHERE COALESCE(billing_afip_crt, '') <> '' AND COALESCE(billing_afip_key, '') <> '';
