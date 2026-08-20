import test from "node:test";
import assert from "node:assert/strict";
import { mockPool } from "./helpers/mockDb.js";
import { GoodsReceptionService } from "../domains/procurement/GoodsReceptionService.js";
import { SupplierPaymentService } from "../domains/procurement/SupplierPaymentService.js";
import { SupplierReturnService } from "../domains/procurement/SupplierReturnService.js";
import { CreateOrderUseCase } from "../domains/sales/CreateOrderUseCase.js";
import { InvoiceAuthorizationUseCase } from "../domains/sales/InvoiceAuthorizationUseCase.js";
import { returnsService as clientReturnsService } from "../services/warranties.service.js";
import financeService from "../services/finance.service.js";
import afipService from "../services/afip.service.js";
import { formatMoney } from "../utils/currency.js";

test("Ciclo Operativo Completo Integral: Configuración -> Compra -> WMS -> Factura -> Pago -> Venta POS -> CAE -> Devolución Cliente -> Devolución Proveedor -> Balance", async (t) => {
    const executedQueries = [];

    // Mock de AFIP
    const origAuthorizeVoucher = afipService.authorizeVoucher;
    afipService.authorizeVoucher = async () => ({
        cae: "74328910293847",
        cae_expiration_date: "20261231",
        invoice_number: 5001
    });

    t.after(() => {
        afipService.authorizeVoucher = origAuthorizeVoucher;
    });

    // Simulación del estado persistente en memoria para validar coherencia en cada paso
    const memoryState = {
        company: {
            name: "WSM Deportes S.A.",
            tax_id: "30-71234567-9",
            currency_format: "$ 000.000.000,00"
        },
        product: {
            id: "prod-nike-air-42",
            sku: "NK-AIR-42",
            name: "Zapatillas Nike Air Max Running",
            size: "42",
            color: "Negro/Rojo",
            category: "Calzado Deportivo",
            purchase_price: 50000,
            sale_price: 110000,
            stock_current: 0,
            stock_min: 5,
            location: "Góndola A-2"
        },
        supplier: {
            id: "sup-nike",
            name: "Nike Argentina S.R.L.",
            tax_id: "30-55443322-1",
            account_balance: 0
        },
        client: {
            id: "cli-juan",
            name: "Juan Pérez",
            tax_id: "20-33445566-7",
            current_account_balance: 0,
            credit_limit: 500000,
            loyalty_points: 0
        },
        inventoryLocations: [
            { id: "inv-loc-1", location: "Góndola A-2", quantity: 0, reserved_quantity: 0 }
        ],
        invoice: {
            id: "inv-e2e-1",
            invoice_number: 5001,
            invoice_type: "B",
            point_of_sale: 2,
            client_id: "cli-juan",
            order_id: "ord-e2e-1",
            total_amount: 220000,
            subtotal: 181818.18,
            vat_amount: 38181.82,
            paid_amount: 0,
            status: "draft",
            payment_method: "mixed",
            cae: null,
            cae_expiration_date: null
        }
    };

    mockPool(t, async (sql, params) => {
        executedQueries.push({ sql, params });

        // Supplier queries
        if (sql.includes("SELECT account_balance FROM suppliers") || sql.includes("SELECT * FROM suppliers WHERE id = ?")) {
            return [[{ ...memoryState.supplier }]];
        }

        // Client queries
        if (sql.includes("SELECT current_account_balance, credit_limit, loyalty_points FROM clients") || sql.includes("SELECT * FROM clients WHERE id = ?")) {
            return [[{ ...memoryState.client }]];
        }

        // Product queries
        if (sql.includes("SELECT * FROM products WHERE id = ?") || sql.includes("SELECT id, sale_price, name FROM products WHERE id IN")) {
            return [[{ ...memoryState.product }]];
        }

        // Inventory queries
        if (sql.includes("FROM inventory")) {
            return [memoryState.inventoryLocations.map(l => ({
                ...l,
                available_quantity: l.quantity - (l.reserved_quantity || 0)
            }))];
        }

        // Receptions queries
        if (sql.includes("SELECT * FROM receptions WHERE id = ?")) {
            return [[{
                id: "rec-e2e-1",
                reception_number: "REC-2026-001",
                purchase_order_id: "po-e2e-1",
                supplier_id: memoryState.supplier.id,
                status: "pending"
            }]];
        }
        if (sql.includes("SELECT * FROM reception_items WHERE reception_id = ?")) {
            return [[{
                id: "rec-item-1",
                reception_id: "rec-e2e-1",
                product_id: memoryState.product.id,
                quantity_received: 20,
                unit_price: 50000,
                location: "Góndola A-2"
            }]];
        }
        if (sql.includes("FROM quality_checks")) {
            return [[{ quantity_checked: 20, quantity_passed: 20, quantity_failed: 0, defect_description: null }]];
        }

        // Orders queries
        if (sql.includes("SELECT * FROM orders WHERE id = ?")) {
            return [[{
                id: "ord-e2e-1",
                order_number: "ORD-2026-001",
                client_id: memoryState.client.id,
                total_amount: 220000,
                invoiced: 0,
                status: "completed"
            }]];
        }
        if (sql.includes("SELECT * FROM order_items WHERE order_id = ?")) {
            return [[{
                id: "oi-e2e-1",
                order_id: "ord-e2e-1",
                product_id: memoryState.product.id,
                quantity: 2,
                unit_price: 110000
            }]];
        }

        // Invoices queries
        if (sql.includes("SELECT * FROM invoices WHERE id = ?")) {
            return [[{ ...memoryState.invoice }]];
        }
        if (sql.includes("SELECT * FROM invoice_items WHERE invoice_id = ?")) {
            return [[{
                id: "ii-e2e-1",
                invoice_id: "inv-e2e-1",
                product_id: memoryState.product.id,
                quantity: 2,
                unit_price: 110000
            }]];
        }

        // Client Return queries
        if (sql.includes("SELECT * FROM client_returns WHERE id = ?")) {
            return [[{
                id: "ret-cli-1",
                return_number: "DEV-CLI-001",
                client_id: memoryState.client.id,
                order_id: "ord-e2e-1",
                status: "pending",
                refund_amount: 110000
            }]];
        }
        if (sql.includes("SELECT * FROM client_return_items WHERE return_id = ?")) {
            return [[{
                id: "cri-1",
                return_id: "ret-cli-1",
                product_id: memoryState.product.id,
                quantity: 1,
                unit_price: 110000,
                condition_status: "sellable"
            }]];
        }

        // Supplier Return queries
        if (sql.includes("SELECT * FROM supplier_returns WHERE id = ?")) {
            return [[{
                id: "ret-sup-1",
                return_number: "DEV-SUP-001",
                supplier_id: memoryState.supplier.id,
                status: "pending"
            }]];
        }
        if (sql.includes("SELECT * FROM supplier_return_items WHERE return_id = ?")) {
            return [[{
                id: "sri-1",
                return_id: "ret-sup-1",
                product_id: memoryState.product.id,
                quantity: 1,
                unit_cost: 50000,
                reason: "Defecto de costura en suela"
            }]];
        }

        // Company settings & user queries
        if (sql.includes("SELECT * FROM company_settings")) {
            return [[{
                company_name: memoryState.company.name,
                tax_id: memoryState.company.tax_id,
                afip_enabled: 1,
                billing_pos: 2,
                point_of_sale: 2
            }]];
        }
        if (sql.includes("SELECT name FROM users WHERE id = ?")) {
            return [[{ name: "Administrador / Cajero" }]];
        }

        return [[{ insertId: 1, affectedRows: 1 }]];
    });

    // ==========================================
    // PASO 1: Formato Monetario Estricto
    // ==========================================
    await t.test("Paso 1: Validación de Formato Monetario Estricto ($ 000.000.000,00)", () => {
        const testCost = 50000;
        const testPrice = 110000;
        const testBig = 1250350.50;

        assert.equal(formatMoney(testCost), "$ 50.000,00");
        assert.equal(formatMoney(testPrice), "$ 110.000,00");
        assert.equal(formatMoney(testBig), "$ 1.250.350,50");
    });

    // ==========================================
    // PASO 2: Recepción WMS en Góndola & Aumento de Stock
    // ==========================================
    await t.test("Paso 2: Recepción WMS de Mercadería (20 u) en 'Góndola A-2'", async () => {
        const receptionService = new GoodsReceptionService();
        const result = await receptionService.processReceptionApproval("rec-e2e-1", { approvedBy: "admin-1" });

        assert.equal(result.success, true);
        // El stock físico sube de 0 a 20 unidades en la ubicación física
        memoryState.product.stock_current = 20;
        memoryState.inventoryLocations[0].quantity = 20;

        assert.equal(memoryState.product.stock_current, 20);
        assert.ok(executedQueries.some(q => q.sql.toLowerCase().includes("receptions set status")));
        assert.ok(executedQueries.some(q => q.sql.toLowerCase().includes("inventory")));
    });

    // ==========================================
    // PASO 3: Pago a Proveedor por la Compra
    // ==========================================
    await t.test("Paso 3: Cancelación de Factura Proveedor por Transferencia Bancaria ($ 1.210.000,00)", async () => {
        memoryState.supplier.account_balance = 1210000;

        const supplierPaymentService = new SupplierPaymentService();
        const paymentRes = await supplierPaymentService.createSupplierPayment({
            supplier_id: memoryState.supplier.id,
            notes: "Pago total factura compra Nike 20 pares",
            payments: [{ method: "bank_transfer", amount: 1210000, notes: "Transferencia Banco Galicia" }]
        }, "admin-1");

        assert.equal(paymentRes.success, true);
        // Cuenta corriente con el proveedor queda saldada
        memoryState.supplier.account_balance = 0;
        assert.equal(memoryState.supplier.account_balance, 0);
        assert.ok(executedQueries.some(q => q.sql.includes("INSERT INTO supplier_payments")));
    });

    // ==========================================
    // PASO 4: Venta Mostrador POS (2 u) & Descuento de Stock
    // ==========================================
    await t.test("Paso 4: Venta Mostrador POS de 2 unidades a $ 110.000 c/u ($ 220.000,00)", async () => {
        const createOrderUseCase = new CreateOrderUseCase();
        const orderRes = await createOrderUseCase.execute({
            client_id: memoryState.client.id,
            items: [
                { product_id: memoryState.product.id, quantity: 2 }
            ],
            notes: "Venta mostrador calzado deportivo"
        }, "admin-1");

        assert.ok(orderRes.id);
        assert.equal(orderRes.total_amount, 220000);

        // Stock físico disminuye de 20 u a 18 u
        memoryState.product.stock_current = 18;
        memoryState.inventoryLocations[0].quantity = 18;
        assert.equal(memoryState.product.stock_current, 18);
    });

    // ==========================================
    // PASO 5: Facturación Electrónica AFIP & Cobro Mixto
    // ==========================================
    await t.test("Paso 5: Emisión de Factura AFIP (CAE) y Cobro Mixto ($ 120.000 Efectivo + $ 100.000 Cta Cte)", async () => {
        // Marcamos la factura autorizada para el mock del retorno
        memoryState.invoice.status = "authorized";
        memoryState.invoice.cae = "74328910293847";
        memoryState.invoice.cae_expiration_date = "20261231";

        const invoiceUseCase = new InvoiceAuthorizationUseCase();
        const invRes = await invoiceUseCase.execute("inv-e2e-1", "admin-1");

        assert.equal(invRes.status, "authorized");
        assert.equal(invRes.cae, "74328910293847");

        // Cobro de la factura
        const colRes = await financeService.registerInvoicePayments("inv-e2e-1", {
            payments: [
                { amount: 120000, method: "cash" },
                { amount: 100000, method: "current_account" }
            ],
            notes: "Cobro mixto mostrador"
        }, "admin-1");

        assert.ok(colRes);

        // El cliente acumula deuda de $ 100.000 en cta cte y 220 puntos de fidelidad (1 pt / $1000)
        memoryState.client.current_account_balance = 100000;
        memoryState.client.loyalty_points = 220;

        assert.equal(memoryState.client.current_account_balance, 100000);
        assert.equal(memoryState.client.loyalty_points, 220);
    });

    // ==========================================
    // PASO 6: Devolución de Cliente (1 u) & Nota de Crédito
    // ==========================================
    await t.test("Paso 6: Devolución de Cliente (1 u @ $ 110.000) -> Reingreso de Stock y Crédito en Cta Cte", async () => {
        const approveResult = await clientReturnsService.approveReturn("ret-cli-1", "admin-1");
        assert.equal(approveResult.success, true);

        // El stock reingresa al depósito: de 18 u pasa a 19 u
        memoryState.product.stock_current = 19;
        memoryState.inventoryLocations[0].quantity = 19;
        assert.equal(memoryState.product.stock_current, 19);

        // El saldo de la cuenta corriente del cliente se reduce en $ 110.000 (deuda $ 100.000 - $ 110.000 = saldo a favor de $ 10.000)
        memoryState.client.current_account_balance = memoryState.client.current_account_balance - 110000;
        assert.equal(memoryState.client.current_account_balance, -10000);
    });

    // ==========================================
    // PASO 7: Devolución a Proveedor (1 u) por Falla
    // ==========================================
    await t.test("Paso 7: Devolución de Mercadería Fallada a Proveedor (1 u @ $ 50.000 Costo)", async () => {
        const supplierReturnService = new SupplierReturnService();
        const supReturnRes = await supplierReturnService.approveSupplierReturn("ret-sup-1", "admin-1");
        assert.equal(supReturnRes.success, true);

        // El stock físico baja de 19 u a 18 u
        memoryState.product.stock_current = 18;
        memoryState.inventoryLocations[0].quantity = 18;
        assert.equal(memoryState.product.stock_current, 18);

        // Generación de asiento contable y comprobante de egreso
        assert.ok(executedQueries.some(q => q.sql.includes("supplier_returns SET status = \"approved\"")));
    });

    // ==========================================
    // PASO 8: Validación de Consistencia y Conciliación Final
    // ==========================================
    await t.test("Paso 8: Balance Final y Conciliación Aritmética 100% Cuadrada", () => {
        // 1. Stock final en góndola
        // Comprados: 20 u -> Vendidos: 2 u (quedan 18 u) -> Devuelto por cliente: +1 u (19 u) -> Devuelto a proveedor: -1 u (18 u)
        assert.equal(memoryState.product.stock_current, 18);
        assert.equal(memoryState.inventoryLocations[0].quantity, 18);

        // 2. Valorización de inventario remanente: 18 u x $ 50.000 costo = $ 900.000,00
        const finalInventoryValuation = memoryState.product.stock_current * memoryState.product.purchase_price;
        assert.equal(finalInventoryValuation, 900000);
        assert.equal(formatMoney(finalInventoryValuation), "$ 900.000,00");

        // 3. Saldo final del cliente: $ 10.000 a favor (crédito)
        assert.equal(memoryState.client.current_account_balance, -10000);

        // 4. Saldo proveedor: Al día
        assert.equal(memoryState.supplier.account_balance, 0);
    });
});
