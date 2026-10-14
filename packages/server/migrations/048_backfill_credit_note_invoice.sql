-- ADR-014: return credit notes issued before credit_notes.invoice_id existed get the invoice
-- of the returned order, so the "creditable balance" of each invoice counts them too.
-- Only where the order has exactly one live invoice (no ambiguous guess). Idempotent: it
-- only touches rows still without invoice_id. Reverse: UPDATE credit_notes SET invoice_id = NULL
-- for the rows listed by this same join (no business data is lost).
UPDATE credit_notes cn
JOIN client_returns r ON r.id = cn.reference_id
JOIN (
    SELECT order_id, MIN(id) AS invoice_id
    FROM invoices
    WHERE deleted_at IS NULL AND order_id IS NOT NULL
    GROUP BY order_id
    HAVING COUNT(*) = 1
) i ON i.order_id = r.order_id
SET cn.invoice_id = i.invoice_id
WHERE cn.reference_type = 'return' AND cn.invoice_id IS NULL;
