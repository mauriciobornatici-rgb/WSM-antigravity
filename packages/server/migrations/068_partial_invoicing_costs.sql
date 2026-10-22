-- ADR-028 (AUD-017).
-- supplier_invoice_items.product_cost: the cost per unit the invoice gave the product (its net plus
-- the VAT of a B or C invoice). A later invoice of the same delivery note line may correct the cost
-- again while the product still has that one (an invoice in parts).
-- supplier_return_items.cost_overridden: purchasing typed the credit cost. Otherwise the approval
-- takes the last invoiced cost (an invoice may arrive between the draft and the approval).
-- Reverse: DROP COLUMN product_cost, DROP COLUMN cost_overridden.
-- (No semicolons in comments: the migration runner splits statements on them.)
ALTER TABLE supplier_invoice_items ADD COLUMN product_cost DECIMAL(15,2) NULL;
ALTER TABLE supplier_return_items ADD COLUMN cost_overridden TINYINT(1) NOT NULL DEFAULT 0;
