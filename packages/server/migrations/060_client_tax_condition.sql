-- ADR-021: the customer's VAT condition (RG 5616). Invoices copy it, and ARCA gets the code
-- of the receiver instead of a guess from the voucher type. NULL means not loaded yet, which
-- keeps the previous behaviour (Consumidor Final, or Responsable Inscripto on a Factura A).
-- The values are the ids of the shared list CLIENT_TAX_CONDITIONS (validated by the API).
-- No foreign key to tax_conditions on purpose: a database seeded before may hold other ids or
-- another collation, and the migration runs at start-up (AUD-009).
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE clients ADD COLUMN tax_condition_id VARCHAR(36) NULL;
