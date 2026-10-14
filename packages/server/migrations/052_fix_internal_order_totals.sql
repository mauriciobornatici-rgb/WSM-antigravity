-- ADR-016 point 6 (usuario, 2026-10-12): orders created inside the ERP before ADR-015 kept the
-- net total (or the total the screen sent). Order totals are VAT-included: an invoiced order
-- takes its invoice total, an order not invoiced yet (or whose invoice was deleted) the final
-- amount of its lines (same formula as the sale, ADR-015). POS and Tiendanube orders already
-- stored what was charged.
-- Rollback: UPDATE orders o JOIN orders_total_backup_052 b ON b.id = o.id SET o.total_amount = b.total_amount
-- (No semicolons in comments: the runner splits statements on them.)
CREATE TABLE IF NOT EXISTS orders_total_backup_052 AS
SELECT id, total_amount, invoice_id, NOW() AS backed_up_at
FROM orders
WHERE external_source IS NULL;

UPDATE orders o
JOIN invoices i ON i.id = o.invoice_id AND i.deleted_at IS NULL
SET o.total_amount = i.total_amount
WHERE o.external_source IS NULL
  AND o.total_amount <> i.total_amount;

UPDATE orders o
JOIN (
    SELECT oi.order_id,
           SUM(ROUND(oi.quantity * oi.unit_price * (1 + COALESCE(p.vat_rate, 21) / 100), 2)) AS gross
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    GROUP BY oi.order_id
) order_lines ON order_lines.order_id = o.id
LEFT JOIN invoices live_invoice ON live_invoice.id = o.invoice_id AND live_invoice.deleted_at IS NULL
SET o.total_amount = order_lines.gross
WHERE o.external_source IS NULL
  AND live_invoice.id IS NULL
  AND o.total_amount <> order_lines.gross;
