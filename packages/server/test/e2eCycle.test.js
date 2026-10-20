import test from "node:test";
import assert from "node:assert/strict";
import { mockPool } from "./helpers/mockDb.js";
import { SupplierPaymentService } from "../domains/procurement/SupplierPaymentService.js";
import { GoodsReceptionService } from "../domains/procurement/GoodsReceptionService.js";
import { CreateOrderUseCase } from "../domains/sales/CreateOrderUseCase.js";
import { InvoiceAuthorizationUseCase } from "../domains/sales/InvoiceAuthorizationUseCase.js";
import financeService from "../services/finance.service.js";

test("Circuito E2E Operativo Completo: Compra -> Stock -> Venta -> Cta Cte -> Cobro -> Caja", async (t) => {
    const executedQueries = [];

    mockPool(t, async (sql, params) => {
        executedQueries.push({ sql, params });

        if (sql.includes("SELECT account_balance FROM suppliers")) {
            return [[{ account_balance: 500000 }]];
        }
        if (sql.includes("SELECT current_account_balance, credit_limit FROM clients")) {
            return [[{ current_account_balance: 0, credit_limit: 1000000 }]];
        }
        if (sql.includes("SELECT * FROM receptions WHERE id = ?")) {
            return [[{ id: "rec-123", status: "pending", reception_number: "R-0001", purchase_order_id: "po-100", supplier_id: "sup-100" }]];
        }
        if (sql.includes("SELECT * FROM reception_items WHERE reception_id = ?")) {
            return [[{ id: "item-1", product_id: "prod-100", quantity_received: 10, unit_cost: 50000 }]];
        }
        if (sql.includes("FROM quality_checks")) {
            return [[{ quantity_checked: 10, quantity_passed: 10, quantity_failed: 0, defect_description: null }]];
        }
        if (sql.includes("SELECT * FROM orders WHERE id = ?")) {
            return [[{ id: "ord-100", client_id: "cli-100", total_amount: 240000, invoiced: 0, status: "completed" }]];
        }
        if (sql.includes("SELECT * FROM order_items WHERE order_id = ?")) {
            return [[{ id: "oi-1", product_id: "prod-100", quantity: 2, unit_price: 120000 }]];
        }
        if (sql.includes("SELECT * FROM invoices WHERE id = ?")) {
            return [[{
                id: "inv-100",
                client_id: "cli-100",
                order_id: "ord-100",
                total_amount: 240000,
                subtotal: 198347.11,
                vat_amount: 41652.89,
                paid_amount: 0,
                status: "authorized",
                payment_method: "cash"
            }]];
        }
        if (sql.includes("SELECT * FROM invoice_items WHERE invoice_id = ?")) {
            return [[{ id: "ii-1", product_id: "prod-100", quantity: 2, unit_price: 120000 }]];
        }
        if (sql.includes("SELECT id, sale_price, name, vat_rate FROM products WHERE id IN")) {
            return [[{ id: "prod-100", name: "Botines Phantom", sale_price: 120000 }]];
        }
        if (sql.includes("SELECT * FROM products WHERE id = ?")) {
            return [[{ id: "prod-100", name: "Botines Phantom", purchase_price: 50000, sale_price: 120000, stock_current: 10, min_stock: 2 }]];
        }
        if (sql.includes("SELECT id, location, quantity, reserved_quantity")) {
            return [[{ id: "inv-loc-1", location: "General", quantity: 10, reserved_quantity: 0, available_quantity: 10 }]];
        }
        if (sql.includes("SELECT * FROM company_settings")) {
            return [[{ company_name: "SportsERP", tax_id: "30-11223344-9", afip_enabled: 1 }]];
        }
        if (sql.includes("SELECT name FROM users WHERE id = ?")) {
            return [[{ name: "Cajero Test" }]];
        }

        return [[{ insertId: 100, affectedRows: 1 }]];
    });

    await t.test("1. Aprobación de Recepción WMS de Mercadería", async () => {
        const receptionService = new GoodsReceptionService();
        const result = await receptionService.processReceptionApproval("rec-123", { approvedBy: "user-100" });

        assert.equal(result.success, true);
        assert.ok(executedQueries.some(q => q.sql.toLowerCase().includes("update receptions set status")));
        assert.ok(executedQueries.some(q => q.sql.toLowerCase().includes("inventory")));
    });

    await t.test("2. Registrar Pago a Proveedor", async () => {
        const supplierPaymentService = new SupplierPaymentService();
        const res = await supplierPaymentService.createSupplierPayment({
            supplier_id: "sup-100",
            notes: "Pago parcial E2E",
            payments: [{ payment_method: "Transferencia", amount: 300000, notes: "Transferencia bancaria" }]
        }, "user-100");

        assert.equal(res.success, true);
        // A transfer never touches the cash drawer (ADR-014): only cash payments need an open shift.
        assert.equal(executedQueries.some(q => q.sql.includes("INSERT INTO shift_payments")), false);
        assert.ok(res.ids.length > 0);
        assert.ok(executedQueries.some(q => q.sql.includes("INSERT INTO supplier_payments")));
        assert.ok(executedQueries.some(q => q.sql.toLowerCase().includes("suppliers")));
    });

    await t.test("3. Procesar Venta POS y Creación de Pedido", async () => {
        const createOrderUseCase = new CreateOrderUseCase();
        const orderRes = await createOrderUseCase.execute({
            client_id: "cli-100",
            items: [
                { product_id: "prod-100", quantity: 2 }
            ],
            notes: "Pedido E2E en Cta Cte"
        }, "user-100");

        assert.ok(orderRes.id);
        // ADR-015: el pedido se cobra con IVA incluido (2 x 120.000 neto x 1,21).
        assert.equal(orderRes.total_amount, 290400);
        assert.ok(executedQueries.some(q => q.sql.includes("INSERT INTO orders")));
    });

    await t.test("4. Emitir Factura y Registrar Cobro a Cliente", async () => {
        const invoiceUseCase = new InvoiceAuthorizationUseCase();
        const invRes = await invoiceUseCase.execute("inv-100", "user-100");

        assert.ok(invRes.id);
        assert.equal(invRes.status, "authorized");

        const colRes = await financeService.registerInvoicePayments("inv-100", {
            payments: [
                { amount: 140000, method: "cash" }
            ],
            notes: "Cobro parcial Cta Cte"
        }, "user-100");

        assert.ok(colRes);
        assert.ok(executedQueries.some(q => q.sql.includes("INSERT INTO transactions")));
        assert.ok(executedQueries.some(q => q.sql.includes("UPDATE invoices SET payment_status")));
    });
});
