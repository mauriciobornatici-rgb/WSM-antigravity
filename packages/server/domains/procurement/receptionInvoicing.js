/**
 * A delivery note whose purchase order was invoiced without naming its delivery notes (the usual way
 * before ADR-019). Its goods reached the ledger through that invoice, so it is not "to invoice": the
 * valuation transition does not open 2.1.01.02 for it, and a return against it lowers what is owed to
 * the supplier (ADR-027). Never one that went through 2.1.01.02: that one waits for its own invoice.
 * `alias` is the alias of `receptions` in the query.
 */
export function invoicedByOrderSql(alias = 'r') {
    return `(${alias}.purchase_order_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries je_b
                        WHERE je_b.reference_type = 'goods_received' AND je_b.reference_id = ${alias}.id)
        AND EXISTS (SELECT 1 FROM supplier_invoices si_o
                    WHERE si_o.purchase_order_id = ${alias}.purchase_order_id
                      AND si_o.reception_id IS NULL
                      AND COALESCE(si_o.status, '') <> 'cancelled'
                      AND COALESCE(si_o.purchase_kind, 'goods') = 'goods'
                      AND NOT EXISTS (SELECT 1 FROM supplier_invoice_receptions sir_o
                                      WHERE sir_o.supplier_invoice_id = si_o.id)))`;
}
