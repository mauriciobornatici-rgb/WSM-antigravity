import test from 'node:test';
import assert from 'node:assert/strict';

import salesService from '../services/sales.service.js';
import pool from '../config/db.js';

test('_decreaseInventoryForOrder throws 409 when total stock is insufficient', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('SELECT id, location, quantity')) {
                return [[
                    { id: 'inv-1', location: 'A-01', quantity: 1, reserved_quantity: 0, available_quantity: 1 },
                    { id: 'inv-2', location: 'A-02', quantity: 2, reserved_quantity: 0, available_quantity: 2 }
                ]];
            }
            throw new Error(`Unexpected SQL in insufficient-stock test: ${statement}`);
        }
    };

    await assert.rejects(
        () => salesService._decreaseInventoryForOrder(connection, {
            orderId: 'order-1',
            productId: 'prod-1',
            productName: 'Botin Pro',
            quantity: 5
        }),
        (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.errorCode, 'INSUFFICIENT_STOCK');
            return true;
        }
    );

    assert.equal(calls.length, 1);
});

test('_decreaseInventoryForOrder consumes inventory across locations and registers reservations', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });

            if (statement.includes('SELECT id, location, quantity')) {
                return [[
                    { id: 'inv-1', location: 'A-01', quantity: 3, reserved_quantity: 0, available_quantity: 3 },
                    { id: 'inv-2', location: 'A-02', quantity: 2, reserved_quantity: 0, available_quantity: 2 }
                ]];
            }
            if (statement.startsWith('UPDATE inventory SET reserved_quantity = reserved_quantity + ? WHERE id = ?')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in stock-consumption test: ${statement}`);
        }
    };

    await salesService._decreaseInventoryForOrder(connection, {
        orderId: 'order-1',
        productId: 'prod-1',
        productName: 'Botin Pro',
        quantity: 4
    });

    const updateCalls = calls.filter((entry) =>
        entry.sql.startsWith('UPDATE inventory SET reserved_quantity = reserved_quantity + ? WHERE id = ?')
    );

    assert.equal(updateCalls.length, 2);
    assert.deepEqual(updateCalls[0].params, [3, 'inv-1']);
    assert.deepEqual(updateCalls[1].params, [1, 'inv-2']);
});

test('createManualInvoice computes granular Mixed-VAT and rounds line-by-line correctly', async () => {
    const connectionCalls = [];
    const connection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql, params) {
            const statement = String(sql);
            connectionCalls.push({ sql: statement, params });

            if (statement.includes('MAX(invoice_number)')) {
                return [[{ max_number: 10 }]];
            }
            if (statement.includes('document_sequences')) {
                return [[{ current_value: 10 }]];
            }
            if (statement.includes('UPDATE document_sequences')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO document_sequences')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO invoices')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO invoice_items')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO transactions')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO client_transactions')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO journal_entries')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO journal_entry_lines')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('SELECT id, name, tax_id, address FROM clients')) {
                return [[{ id: 'client-1', name: 'Cliente Test', tax_id: '20-12345678-9', address: 'Calle Falsa 123' }]];
            }
            if (statement.includes('UPDATE clients')) {
                return [{ affectedRows: 1 }];
            }
            throw new Error(`Unexpected SQL inside test: ${statement}`);
        }
    };

    const originalGetConnection = pool.getConnection;
    pool.getConnection = async () => connection;

    try {
        const invoiceData = {
            invoice_type: 'A',
            point_of_sale: 1,
            client_id: 'client-1',
            payments: [{ method: 'cash', amount: 331.50 }],
            items: [
                {
                    product_id: 'p1',
                    product_name: 'Mixed VAT item 21%',
                    quantity: 2,
                    unit_price: 100, // 200 net + 42 VAT = 242 total
                    vat_rate: 21
                },
                {
                    product_id: 'p2',
                    product_name: 'Mixed VAT item 10.5%',
                    quantity: 1,
                    unit_price: 81.00, // 81 net + 8.505 VAT (8.50 rounded in JS float) = 89.50 total
                    vat_rate: 10.5
                }
            ]
        };

        const result = await salesService.createManualInvoice(invoiceData, 'user-1');

        assert.equal(result.status, 'issued');
        assert.equal(result.total_amount, 331.50); // 242.00 + 89.50 = 331.50
        assert.equal(result.paid_amount, 331.50); // paid as specified in payment line
        assert.equal(result.payment_status, 'paid'); // 331.50 paid, 331.50 total

        // Validate insert query net and vat amounts
        const invoiceInsertCall = connectionCalls.find(c => c.sql.includes('INSERT INTO invoices'));
        assert.ok(invoiceInsertCall);
        const [
            id, order_id, client_id, client_name, client_tax_id, client_address, client_tax_condition,
            invoice_type, point_of_sale, invoice_number,
            net_amount, vat_amount, total_amount_param
        ] = invoiceInsertCall.params;

        assert.equal(net_amount, 281.00); // 200 + 81
        assert.equal(vat_amount, 50.50); // 42.00 + 8.50
        assert.equal(total_amount_param, 331.50);
    } finally {
        pool.getConnection = originalGetConnection;
    }
});
