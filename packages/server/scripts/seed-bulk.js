import { fakerES as faker } from '@faker-js/faker';
import crypto from 'crypto';
import pool from '../config/db.js';

// Configuration
const NUM_CLIENTS = 1000;
const NUM_PRODUCTS = 5000;
const NUM_ORDERS = 10000;
const BATCH_SIZE = 500; // Batch insert size

const generateUUID = () => crypto.randomUUID();

async function runSeeder() {
    console.log("🚀 Iniciando Seeder Masivo (Data Bulk)...");
    
    // Check if we are in development environment (protection)
    const [rows] = await pool.query('SELECT DATABASE() AS dbName');
    const dbName = rows[0].dbName;
    if (!dbName.includes('dev') && !dbName.includes('test') && !dbName.includes('sports')) {
        console.error(`❌ Seguridad: Previniendo inserción masiva en base de datos de producción: ${dbName}`);
        process.exit(1);
    }

    try {
        // Disable foreign key checks for faster inserts
        await pool.query('SET FOREIGN_KEY_CHECKS = 0;');

        // 1. Clear existing data
        console.log("🧹 Vaciando tablas relacionadas...");
        await pool.query('TRUNCATE TABLE order_items;');
        await pool.query('TRUNCATE TABLE transactions;');
        await pool.query('TRUNCATE TABLE invoices;');
        await pool.query('TRUNCATE TABLE orders;');
        await pool.query('TRUNCATE TABLE products;');
        await pool.query('TRUNCATE TABLE clients;');

        // 2. Generate Clients
        console.log(`👤 Insertando ${NUM_CLIENTS} clientes...`);
        const clientIds = [];
        for (let i = 0; i < NUM_CLIENTS; i += BATCH_SIZE) {
            const batch = [];
            for (let j = 0; j < BATCH_SIZE && i + j < NUM_CLIENTS; j++) {
                const id = generateUUID();
                clientIds.push(id);
                batch.push([
                    id,
                    faker.company.name(),
                    faker.internet.email(),
                    faker.phone.number(),
                    faker.finance.routingNumber(),
                    faker.location.streetAddress(),
                    faker.number.int({ min: 0, max: 1000000 }), // account_balance
                    faker.number.int({ min: 0, max: 5000000 })  // credit_limit
                ]);
            }
            if (batch.length > 0) {
                await pool.query(
                    `INSERT INTO clients (id, name, email, phone, tax_id, address, account_balance, credit_limit) VALUES ?`,
                    [batch]
                );
            }
        }

        // 3. Generate Products
        console.log(`📦 Insertando ${NUM_PRODUCTS} productos...`);
        const productIds = [];
        const categories = ['Calzado', 'Ropa', 'Accesorios', 'Equipamiento', 'Nutrición', 'Electrónica'];
        for (let i = 0; i < NUM_PRODUCTS; i += BATCH_SIZE) {
            const batch = [];
            for (let j = 0; j < BATCH_SIZE && i + j < NUM_PRODUCTS; j++) {
                const id = generateUUID();
                productIds.push(id);
                const cost = faker.number.float({ min: 5, max: 500, fractionDigits: 2 });
                batch.push([
                    id,
                    `SKU-${faker.string.alphanumeric(8).toUpperCase()}`,
                    faker.string.numeric(13), // barcode
                    faker.commerce.productName(),
                    faker.commerce.productDescription(),
                    faker.helpers.arrayElement(categories),
                    cost, // purchase_price
                    cost * 1.1, // cost_price
                    cost * faker.number.float({ min: 1.3, max: 2.5, fractionDigits: 2 }), // sale_price
                    faker.number.int({ min: 0, max: 500 }), // stock
                    'active'
                ]);
            }
            if (batch.length > 0) {
                await pool.query(
                    `INSERT INTO products (id, sku, barcode, name, description, category, purchase_price, cost_price, sale_price, stock_total, status) VALUES ?`,
                    [batch]
                );
            }
        }

        // 4. Generate Orders & Items
        console.log(`🛒 Insertando ${NUM_ORDERS} pedidos y transacciones...`);
        const statuses = ['completed', 'delivered', 'cancelled', 'pending', 'picking'];
        const paymentMethods = ['cash', 'transfer', 'credit_card', 'debit_card'];
        
        for (let i = 0; i < NUM_ORDERS; i += BATCH_SIZE) {
            const orderBatch = [];
            const itemBatch = [];
            const transactionBatch = [];

            for (let j = 0; j < BATCH_SIZE && i + j < NUM_ORDERS; j++) {
                const orderId = generateUUID();
                const clientId = faker.helpers.arrayElement(clientIds);
                const status = faker.helpers.arrayElement(statuses);
                const totalAmount = faker.number.float({ min: 50, max: 2000, fractionDigits: 2 });
                const orderDate = faker.date.past({ years: 1 }); // Orders from last year

                orderBatch.push([
                    orderId,
                    `ORD-${faker.string.numeric(6)}`,
                    clientId,
                    status,
                    totalAmount,
                    faker.helpers.arrayElement(paymentMethods),
                    orderDate,
                    orderDate
                ]);

                // Create 1 to 5 items per order
                const numItems = faker.number.int({ min: 1, max: 5 });
                for (let k = 0; k < numItems; k++) {
                    itemBatch.push([
                        generateUUID(),
                        orderId,
                        faker.helpers.arrayElement(productIds),
                        faker.number.int({ min: 1, max: 10 }), // quantity
                        faker.number.float({ min: 10, max: 500, fractionDigits: 2 }) // unit price
                    ]);
                }

                // If completed, create a transaction
                if (status === 'completed' || status === 'delivered') {
                    transactionBatch.push([
                        generateUUID(),
                        'client_payment',
                        totalAmount,
                        clientId,
                        null,
                        orderDate,
                        orderId
                    ]);
                }
            }

            if (orderBatch.length > 0) {
                await pool.query(
                    `INSERT INTO orders (id, order_number, client_id, status, total_amount, payment_method, created_at, updated_at) VALUES ?`,
                    [orderBatch]
                );
            }
            if (itemBatch.length > 0) {
                await pool.query(
                    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES ?`,
                    [itemBatch]
                );
            }
            if (transactionBatch.length > 0) {
                await pool.query(
                    `INSERT INTO transactions (id, type, amount, client_id, supplier_id, date, reference_id) VALUES ?`,
                    [transactionBatch]
                );
            }
        }

        console.log("✅ Seeder completado exitosamente.");

    } catch (error) {
        console.error("❌ Error en Seeder:", error);
    } finally {
        await pool.query('SET FOREIGN_KEY_CHECKS = 1;');
        pool.end();
    }
}

runSeeder();
