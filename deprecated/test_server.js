console.log("SERVER STARTING VERSION 2");
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db.js';
import crypto from 'crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    if (req.method === 'POST' || req.method === 'PUT') console.log('Body:', req.body);
    next();
});

// ==================== HEALTH CHECK ====================
app.get('/api/routes', (req, res) => {
    const routes = [];
    app._router.stack.forEach(r => {
        if (r.route && r.route.path) {
            routes.push(`${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`);
        }
    });
    res.json(routes);
});

app.get('/api/health', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 as val');
        res.json({ status: 'ok', db: 'connected', val: rows[0].val });
    } catch (error) {
        console.error('Database connection failed:', error);
        res.status(500).json({ status: 'error', message: 'Database connection failed', error: error.message });
    }
});

// ==================== PRODUCTS ====================
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', async (req, res) => {
    const { sku, name, description, category, image_url, location, purchase_price, sale_price } = req.body;
    const id = crypto.randomUUID();
    try {
        // Check for duplicate SKU
        const [existingSKU] = await pool.query('SELECT id FROM products WHERE sku = ?', [sku]);
        if (existingSKU.length > 0) {
            return res.status(409).json({ error: 'duplicate_sku', message: 'Ya existe un producto con ese código SKU' });
        }

        // Check for duplicate name
        const [existingName] = await pool.query('SELECT id FROM products WHERE LOWER(name) = LOWER(?)', [name]);
        if (existingName.length > 0) {
            return res.status(409).json({ error: 'duplicate_name', message: 'Ya existe un producto con ese nombre' });
        }

        await pool.query(
            'INSERT INTO products (id, sku, name, description, category, image_url, location, purchase_price, sale_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, sku, name, description, category, image_url, location, purchase_price, sale_price]
        );
        const [newItem] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
        res.json(newItem[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { sku, name, description, category, image_url, location, purchase_price, sale_price } = req.body;
    try {
        // Check if product exists
        const [existing] = await pool.query('SELECT id FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Producto no encontrado' });
        }

        // Check for duplicate SKU (excluding current product)
        const [existingSKU] = await pool.query('SELECT id FROM products WHERE sku = ? AND id != ?', [sku, id]);
        if (existingSKU.length > 0) {
            return res.status(409).json({ error: 'duplicate_sku', message: 'Ya existe un producto con ese código SKU' });
        }

        // Check for duplicate name (excluding current product)
        const [existingName] = await pool.query('SELECT id FROM products WHERE LOWER(name) = LOWER(?) AND id != ?', [name, id]);
        if (existingName.length > 0) {
            return res.status(409).json({ error: 'duplicate_name', message: 'Ya existe un producto con ese nombre' });
        }

        await pool.query(
            'UPDATE products SET sku = ?, name = ?, description = ?, category = ?, image_url = ?, location = ?, purchase_price = ?, sale_price = ? WHERE id = ?',
            [sku, name, description, category, image_url, location, purchase_price, sale_price, id]
        );
        const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Check if product exists
        const [existing] = await pool.query('SELECT id, name FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Producto no encontrado' });
        }

        // Check if product has inventory
        const [inventory] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ? AND quantity > 0', [id]);
        if (inventory.length > 0) {
            return res.status(409).json({
                error: 'has_inventory',
                message: `No se puede eliminar el producto "${existing[0].name}" porque tiene stock en inventario (${inventory[0].quantity} unidades)`
            });
        }

        // Check if product is in orders
        const [orders] = await pool.query('SELECT COUNT(*) as count FROM order_items WHERE product_id = ?', [id]);
        if (orders[0].count > 0) {
            return res.status(409).json({
                error: 'has_orders',
                message: `No se puede eliminar el producto "${existing[0].name}" porque está asociado a ${orders[0].count} orden(es) de venta`
            });
        }

        await pool.query('DELETE FROM products WHERE id = ?', [id]);
        res.json({ success: true, message: 'Producto eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== CLIENTS ====================
app.get('/api/clients', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clients', async (req, res) => {
    const { name, tax_id, email, phone, address, credit_limit } = req.body;
    const id = crypto.randomUUID();
    try {
        // Check for duplicate tax_id (CUIT/CUIL/DNI)
        const [existing] = await pool.query('SELECT id FROM clients WHERE tax_id = ?', [tax_id]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un cliente con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'INSERT INTO clients (id, name, tax_id, email, phone, address, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, name, tax_id, email, phone, address, credit_limit || 0]
        );
        const [newItem] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
        res.json(newItem[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/clients/:id', async (req, res) => {
    const { id } = req.params;
    const { name, tax_id, email, phone, address, credit_limit } = req.body;
    try {
        // Check if client exists
        const [existing] = await pool.query('SELECT id FROM clients WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Cliente no encontrado' });
        }

        // Check for duplicate tax_id (excluding current client)
        const [existingTaxId] = await pool.query('SELECT id FROM clients WHERE tax_id = ? AND id != ?', [tax_id, id]);
        if (existingTaxId.length > 0) {
            return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un cliente con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'UPDATE clients SET name = ?, tax_id = ?, email = ?, phone = ?, address = ?, credit_limit = ? WHERE id = ?',
            [name, tax_id, email, phone, address, credit_limit || 0, id]
        );
        const [updated] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Check if client exists
        const [existing] = await pool.query('SELECT id, name, current_account_balance FROM clients WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Cliente no encontrado' });
        }

        // Check if client has account balance
        if (existing[0].current_account_balance !== 0) {
            return res.status(409).json({
                error: 'has_balance',
                message: `No se puede eliminar el cliente "${existing[0].name}" porque tiene un saldo pendiente en cuenta corriente`
            });
        }

        // Check if client has orders
        const [orders] = await pool.query('SELECT COUNT(*) as count FROM orders WHERE client_id = ?', [id]);
        if (orders[0].count > 0) {
            return res.status(409).json({
                error: 'has_orders',
                message: `No se puede eliminar el cliente "${existing[0].name}" porque tiene ${orders[0].count} orden(es) asociada(s)`
            });
        }

        await pool.query('DELETE FROM clients WHERE id = ?', [id]);
        res.json({ success: true, message: 'Cliente eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM suppliers ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/suppliers', async (req, res) => {
    const { name, tax_id, contact_name, email, phone, address } = req.body;
    const id = crypto.randomUUID();
    try {
        // Check for duplicate tax_id (CUIT/CUIL/DNI)
        const [existing] = await pool.query('SELECT id FROM suppliers WHERE tax_id = ?', [tax_id]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'INSERT INTO suppliers (id, name, tax_id, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, name, tax_id, contact_name, email, phone, address]
        );
        const [newItem] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
        res.json(newItem[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/suppliers/:id', async (req, res) => {
    const { id } = req.params;
    const { name, tax_id, contact_name, email, phone, address } = req.body;
    try {
        // Check if supplier exists
        const [existing] = await pool.query('SELECT id FROM suppliers WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Proveedor no encontrado' });
        }

        // Check for duplicate tax_id (excluding current supplier)
        const [existingTaxId] = await pool.query('SELECT id FROM suppliers WHERE tax_id = ? AND id != ?', [tax_id, id]);
        if (existingTaxId.length > 0) {
            return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'UPDATE suppliers SET name = ?, tax_id = ?, contact_name = ?, email = ?, phone = ?, address = ? WHERE id = ?',
            [name, tax_id, contact_name, email, phone, address, id]
        );
        const [updated] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/suppliers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Check if supplier exists
        const [existing] = await pool.query('SELECT id, name, account_balance FROM suppliers WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Proveedor no encontrado' });
        }

        // Check if supplier has account balance
        if (existing[0].account_balance !== 0) {
            return res.status(409).json({
                error: 'has_balance',
                message: `No se puede eliminar el proveedor "${existing[0].name}" porque tiene un saldo pendiente en cuenta`
            });
        }

        // Check if supplier has transactions
        const [transactions] = await pool.query('SELECT COUNT(*) as count FROM transactions WHERE supplier_id = ?', [id]);
        if (transactions[0].count > 0) {
            return res.status(409).json({
                error: 'has_transactions',
                message: `No se puede eliminar el proveedor "${existing[0].name}" porque tiene ${transactions[0].count} transacción(es) asociada(s)`
            });
        }

        await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);
        res.json({ success: true, message: 'Proveedor eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== INVENTORY ====================
app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT i.*, p.name as product_name, p.sku, p.category 
            FROM inventory i 
            LEFT JOIN products p ON i.product_id = p.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ORDERS ====================
app.get('/api/orders', async (req, res) => {
    const { client_id } = req.query;
    try {
        let query = `
            SELECT o.*, c.name as client_name
            FROM orders o
            LEFT JOIN clients c ON o.client_id = c.id
        `;
        const params = [];
        if (client_id) {
            query += ' WHERE o.client_id = ?';
            params.push(client_id);
        }
        query += ' ORDER BY o.created_at DESC';

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders', async (req, res) => {
    const { client_id, total_amount, items, transaction_type, customer_name } = req.body;
    const orderId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Create Order
        await connection.query(
            'INSERT INTO orders (id, client_id, customer_name, total_amount, status) VALUES (?, ?, ?, ?, ?)',
            [orderId, client_id || null, customer_name || 'Consumidor Final', total_amount, 'completed']
        );

        // 2. Create Order Items
        for (const item of items) {
            const itemId = crypto.randomUUID();
            // Fetch product price from DB
            const [productData] = await connection.query('SELECT sale_price FROM products WHERE id = ?', [item.product_id]);
            const unitPrice = productData[0]?.sale_price || 0;

            await connection.query(
                'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
                [itemId, orderId, item.product_id, item.quantity, unitPrice]
            );

            // Update Stock
            await connection.query(
                'UPDATE inventory SET quantity = quantity - ? WHERE product_id = ?',
                [item.quantity, item.product_id]
            );
        }

        // 3. Create Transaction
        await connection.query(
            'INSERT INTO transactions (id, type, amount, description, reference_id, client_id, date) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [transactionId, 'sale', total_amount, `Venta POS`, orderId, client_id || null]
        );

        // 4. Update Client Balance if Credit Sale
        if (transaction_type === 'account' && client_id) {
            await connection.query(
                'UPDATE clients SET current_account_balance = current_account_balance + ? WHERE id = ?',
                [total_amount, client_id]
            );
        }

        await connection.commit();
        res.json({ id: orderId, status: 'completed' });

    } catch (error) {
        await connection.rollback();
        console.error('Order creation failed:', error);
        res.status(500).json({ error: 'Failed to process order' });
    } finally {
        connection.release();
    }
});

// Get order summary for ticket
app.get('/api/orders/:id/summary', async (req, res) => {
    const { id } = req.params;
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
        if (orders.length === 0) return res.status(404).json({ error: 'Order not found' });

        const [items] = await pool.query(`
            SELECT oi.*, p.name as product_name 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = ?
        `, [id]);

        res.json({ ...orders[0], items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== TRANSACTIONS ====================
app.get('/api/transactions', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT t.*, c.name as client_name, s.name as supplier_name
            FROM transactions t
            LEFT JOIN clients c ON t.client_id = c.id
            LEFT JOIN suppliers s ON t.supplier_id = s.id
            ORDER BY t.date DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== SETTINGS ====================
app.get('/api/settings/company', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
        res.json(rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings/company', async (req, res) => {
    try {
        const settings = req.body;
        await pool.query(`
            INSERT INTO company_settings (id, brand_name, legal_name, tax_id, logo_url, contact_phone, contact_email, address_street, address_city)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                brand_name = VALUES(brand_name),
                legal_name = VALUES(legal_name),
                tax_id = VALUES(tax_id),
                logo_url = VALUES(logo_url),
                contact_phone = VALUES(contact_phone),
                contact_email = VALUES(contact_email),
                address_street = VALUES(address_street),
                address_city = VALUES(address_city)
        `, [settings.brand_name, settings.legal_name, settings.tax_id, settings.logo_url,
        settings.contact_phone, settings.contact_email, settings.address_street, settings.address_city]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== INVENTORY MOVEMENTS ====================

// Get all movements with filters
app.get('/api/inventory-movements', async (req, res) => {
    const { product_id, type, start_date, end_date, limit = 100 } = req.query;

    try {
        let query = `
            SELECT im.*, p.name as product_name, p.sku
            FROM inventory_movements im
            LEFT JOIN products p ON im.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (product_id) {
            query += ' AND im.product_id = ?';
            params.push(product_id);
        }
        if (type) {
            query += ' AND im.type = ?';
            params.push(type);
        }
        if (start_date) {
            query += ' AND im.created_at >= ?';
            params.push(start_date);
        }
        if (end_date) {
            query += ' AND im.created_at <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY im.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const [movements] = await pool.query(query, params);
        res.json(movements);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new movement (manual adjustment)
app.post('/api/inventory-movements', async (req, res) => {
    const {
        type, product_id, from_location, to_location,
        quantity, unit_cost, reason, notes, performed_by
    } = req.body;

    const id = crypto.randomUUID();

    try {
        await pool.query(`
            INSERT INTO inventory_movements 
            (id, type, product_id, from_location, to_location, quantity, 
             unit_cost, reason, reference_type, notes, performed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
        `, [id, type, product_id, from_location, to_location, quantity,
            unit_cost, reason, notes, performed_by]);

        const [newMovement] = await pool.query(
            'SELECT * FROM inventory_movements WHERE id = ?', [id]
        );
        res.json(newMovement[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get movements by product
app.get('/api/products/:id/movements', async (req, res) => {
    const { id } = req.params;
    try {
        const [movements] = await pool.query(`
            SELECT im.*
            FROM inventory_movements im
            WHERE im.product_id = ?
            ORDER BY im.created_at DESC
            LIMIT 50
        `, [id]);
        res.json(movements);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== BATCHES ====================

app.get('/api/batches', async (req, res) => {
    const { product_id, status = 'active' } = req.query;
    try {
        let query = `
            SELECT b.*, p.name as product_name, p.sku, s.name as supplier_name
            FROM product_batches b
            LEFT JOIN products p ON b.product_id = p.id
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            WHERE b.status = ?
        `;
        const params = [status];

        if (product_id) {
            query += ' AND b.product_id = ?';
            params.push(product_id);
        }

        query += ' ORDER BY b.expiration_date ASC';

        const [batches] = await pool.query(query, params);
        res.json(batches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/batches', async (req, res) => {
    const {
        product_id, batch_number, manufacturing_date, expiration_date,
        supplier_id, quantity_initial, location, notes
    } = req.body;

    const id = crypto.randomUUID();

    try {
        // Check for duplicate batch number
        const [existing] = await pool.query(
            'SELECT id FROM product_batches WHERE product_id = ? AND batch_number = ?',
            [product_id, batch_number]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                error: 'duplicate_batch',
                message: 'Ya existe un lote con este número para este producto'
            });
        }

        await pool.query(`
            INSERT INTO product_batches
            (id, product_id, batch_number, manufacturing_date, expiration_date,
             supplier_id, quantity_initial, quantity_current, location, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, product_id, batch_number, manufacturing_date, expiration_date,
            supplier_id, quantity_initial, quantity_initial, location, notes]);

        const [newBatch] = await pool.query(
            'SELECT * FROM product_batches WHERE id = ?', [id]
        );
        res.json(newBatch[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update batch quantity
app.put('/api/batches/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity_current, status } = req.body;

    try {
        await pool.query(
            'UPDATE product_batches SET quantity_current = ?, status = ? WHERE id = ?',
            [quantity_current, status || 'active', id]
        );

        const [updated] = await pool.query('SELECT * FROM product_batches WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== SERIAL NUMBERS ====================

app.get('/api/serials', async (req, res) => {
    const { product_id, status = 'available' } = req.query;
    try {
        let query = `
            SELECT s.*, p.name as product_name, p.sku, c.name as client_name
            FROM serial_numbers s
            LEFT JOIN products p ON s.product_id = p.id
            LEFT JOIN clients c ON s.sold_to_client_id = c.id
            WHERE s.status = ?
        `;
        const params = [status];

        if (product_id) {
            query += ' AND s.product_id = ?';
            params.push(product_id);
        }

        query += ' ORDER BY s.created_at DESC';

        const [serials] = await pool.query(query, params);
        res.json(serials);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/serials', async (req, res) => {
    const { product_id, serial_number, batch_id, location, warranty_months } = req.body;
    const id = crypto.randomUUID();

    try {
        // Check for duplicate
        const [existing] = await pool.query(
            'SELECT id FROM serial_numbers WHERE serial_number = ?',
            [serial_number]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                error: 'duplicate_serial',
                message: 'Ya existe un producto con este número de serie'
            });
        }

        const warranty_expiration = warranty_months
            ? new Date(Date.now() + warranty_months * 30 * 24 * 60 * 60 * 1000)
            : null;

        await pool.query(`
            INSERT INTO serial_numbers
            (id, product_id, serial_number, batch_id, location, warranty_expiration)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, product_id, serial_number, batch_id, location, warranty_expiration]);

        const [newSerial] = await pool.query(
            'SELECT * FROM serial_numbers WHERE id = ?', [id]
        );
        res.json(newSerial[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update serial status (e.g., when sold)
app.put('/api/serials/:id', async (req, res) => {
    const { id } = req.params;
    const { status, sold_to_client_id, sold_in_order_id, location } = req.body;

    try {
        const sale_date = (status === 'sold' && sold_in_order_id) ? new Date() : null;

        await pool.query(`
            UPDATE serial_numbers 
            SET status = ?, sold_to_client_id = ?, sold_in_order_id = ?, 
                sale_date = ?, location = ?
            WHERE id = ?
        `, [status, sold_to_client_id || null, sold_in_order_id || null,
            sale_date, location || null, id]);

        const [updated] = await pool.query('SELECT * FROM serial_numbers WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==================== PURCHASE ORDERS ====================

// Get all purchase orders
app.get('/api/purchase-orders', async (req, res) => {
    const { supplier_id, status } = req.query;
    try {
        let query = `
            SELECT po.*, s.name as supplier_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON po.supplier_id = s.id
            WHERE 1=1
        `;
        const params = [];

        if (supplier_id) {
            query += ' AND po.supplier_id = ?';
            params.push(supplier_id);
        }
        if (status) {
            query += ' AND po.status = ?';
            params.push(status);
        }

        query += ' ORDER BY po.created_at DESC';

        const [orders] = await pool.query(query, params);

        // Get items for each order
        for (let order of orders) {
            const [items] = await pool.query(`
                SELECT poi.*, p.name as product_name, p.sku
                FROM purchase_order_items poi
                LEFT JOIN products p ON poi.product_id = p.id
                WHERE poi.purchase_order_id = ?
            `, [order.id]);
            order.items = items;
        }

        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single purchase order
app.get('/api/purchase-orders/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [orders] = await pool.query(`
            SELECT po.*, s.name as supplier_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON po.supplier_id = s.id
            WHERE po.id = ?
        `, [id]);

        if (orders.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Orden de compra no encontrada' });
        }

        const order = orders[0];

        // Get items
        const [items] = await pool.query(`
            SELECT poi.*, p.name as product_name, p.sku
            FROM purchase_order_items poi
            LEFT JOIN products p ON poi.product_id = p.id
            WHERE poi.purchase_order_id = ?
        `, [id]);

        order.items = items;
        res.json(order);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create purchase order
app.post('/api/purchase-orders', async (req, res) => {
    const { supplier_id, order_date, expected_delivery_date, items, notes } = req.body;
    const id = crypto.randomUUID();

    try {
        // Generate PO number
        const [lastPO] = await pool.query(
            'SELECT po_number FROM purchase_orders ORDER BY created_at DESC LIMIT 1'
        );
        let poNumber = 'PO-2024-001';
        if (lastPO.length > 0) {
            const lastNum = parseInt(lastPO[0].po_number.split('-')[2]);
            poNumber = `PO-2024-${String(lastNum + 1).padStart(3, '0')}`;
        }

        // Calculate totals
        let subtotal = 0;
        items.forEach(item => {
            subtotal += item.quantity_ordered * item.unit_cost;
        });
        const tax_amount = subtotal * 0.21; // 21% IVA
        const total_amount = subtotal + tax_amount;

        // Create PO
        await pool.query(`
            INSERT INTO purchase_orders
            (id, po_number, supplier_id, order_date, expected_delivery_date,
             status, subtotal, tax_amount, total_amount, notes)
            VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
        `, [id, poNumber, supplier_id, order_date, expected_delivery_date,
            subtotal, tax_amount, total_amount, notes]);

        // Create items
        for (let item of items) {
            const itemId = crypto.randomUUID();
            await pool.query(`
                INSERT INTO purchase_order_items
                (id, purchase_order_id, product_id, quantity_ordered, unit_cost)
                VALUES (?, ?, ?, ?, ?)
            `, [itemId, id, item.product_id, item.quantity_ordered, item.unit_cost]);
        }

        // Return created PO
        const [newPO] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
        res.json(newPO[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update purchase order status
app.put('/api/purchase-orders/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        await pool.query(
            'UPDATE purchase_orders SET status = ? WHERE id = ?',
            [status, id]
        );

        const [updated] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== RECEPTIONS ====================

// Get all receptions
app.get('/api/receptions', async (req, res) => {
    const { status, supplier_id } = req.query;
    try {
        let query = `
            SELECT r.*, s.name as supplier_name, po.po_number
            FROM receptions r
            LEFT JOIN suppliers s ON r.supplier_id = s.id
            LEFT JOIN purchase_orders po ON r.purchase_order_id = po.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND r.status = ?';
            params.push(status);
        }
        if (supplier_id) {
            query += ' AND r.supplier_id = ?';
            params.push(supplier_id);
        }

        query += ' ORDER BY r.created_at DESC';

        const [receptions] = await pool.query(query, params);

        // Get items for each reception
        for (let reception of receptions) {
            const [items] = await pool.query(`
                SELECT ri.*, p.name as product_name, p.sku
                FROM reception_items ri
                LEFT JOIN products p ON ri.product_id = p.id
                WHERE ri.reception_id = ?
            `, [reception.id]);
            reception.items = items;
        }

        res.json(receptions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create reception
app.post('/api/receptions', async (req, res) => {
    const { purchase_order_id, supplier_id, remito_number, items, notes } = req.body;
    const id = crypto.randomUUID();

    try {
        // Generate reception number
        const [lastReception] = await pool.query(
            'SELECT reception_number FROM receptions ORDER BY created_at DESC LIMIT 1'
        );
        let receptionNumber = 'REC-2024-001';
        if (lastReception.length > 0) {
            const lastNum = parseInt(lastReception[0].reception_number.split('-')[2]);
            receptionNumber = `REC-2024-${String(lastNum + 1).padStart(3, '0')}`;
        }

        // Create reception
        await pool.query(`
            INSERT INTO receptions
            (id, reception_number, purchase_order_id, supplier_id, remito_number, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, receptionNumber, purchase_order_id, supplier_id, remito_number, notes]);

        // Create reception items
        for (let item of items) {
            const itemId = crypto.randomUUID();
            await pool.query(`
                INSERT INTO reception_items
                (id, reception_id, product_id, po_item_id, quantity_expected,
                 quantity_received, unit_cost, location_assigned, batch_number, expiration_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [itemId, id, item.product_id, item.po_item_id || null,
                item.quantity_expected || 0, item.quantity_received,
                item.unit_cost, item.location_assigned, item.batch_number, item.expiration_date]);

            // Update PO item received quantity
            if (item.po_item_id) {
                await pool.query(`
                    UPDATE purchase_order_items
                    SET quantity_received = quantity_received + ?
                    WHERE id = ?
                `, [item.quantity_received, item.po_item_id]);
            }
        }

        const [newReception] = await pool.query('SELECT * FROM receptions WHERE id = ?', [id]);
        res.json(newReception[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve reception (creates inventory movements and batches)
app.post('/api/receptions/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { approved_by } = req.body;

    try {
        // Get reception with items
        const [reception] = await pool.query('SELECT * FROM receptions WHERE id = ?', [id]);
        if (reception.length === 0) {
            return res.status(404).json({ error: 'not_found', message: 'Recepción no encontrada' });
        }

        const [items] = await pool.query('SELECT * FROM reception_items WHERE reception_id = ?', [id]);

        // For each item, create inventory movement and update inventory
        for (let item of items) {
            const approved_qty = item.quantity_received - (item.quantity_rejected || 0);
            item.quantity_approved = approved_qty;

            // Update reception item
            await pool.query(
                'UPDATE reception_items SET quantity_approved = ? WHERE id = ?',
                [approved_qty, item.id]
            );

            // Create inventory movement
            const movementId = crypto.randomUUID();
            await pool.query(`
                INSERT INTO inventory_movements
                (id, type, product_id, from_location, to_location, quantity,
                 unit_cost, reference_type, reference_id, performed_by)
                VALUES (?, 'reception', ?, NULL, ?, ?, ?, 'reception', ?, ?)
            `, [movementId, item.product_id, item.location_assigned || 'INCOMING',
                approved_qty, item.unit_cost, id, approved_by || 'system']);

            // Update product inventory
            const [inventory] = await pool.query(
                'SELECT * FROM inventory WHERE product_id = ? AND location = ? LIMIT 1',
                [item.product_id, item.location_assigned || 'INCOMING']
            );

            if (inventory.length > 0) {
                await pool.query(
                    'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                    [approved_qty, inventory[0].id]
                );
            } else {
                const invId = crypto.randomUUID();
                await pool.query(`
                    INSERT INTO inventory (id, product_id, location, quantity)
                    VALUES (?, ?, ?, ?)
                `, [invId, item.product_id, item.location_assigned || 'INCOMING', approved_qty]);
            }

            // Create batch if has batch info
            if (item.batch_number) {
                const batchId = crypto.randomUUID();
                await pool.query(`
                    INSERT INTO product_batches
                    (id, product_id, batch_number, expiration_date, supplier_id,
                     reception_id, quantity_initial, quantity_current, location)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [batchId, item.product_id, item.batch_number, item.expiration_date,
                    reception[0].supplier_id, id, approved_qty, approved_qty,
                    item.location_assigned]);
            }
        }

        // Update reception status
        await pool.query(
            'UPDATE receptions SET status = ?, approved_by = ? WHERE id = ?',
            ['approved', approved_by, id]
        );

        // Update PO status if all items received
        if (reception[0].purchase_order_id) {
            const [poItems] = await pool.query(`
                SELECT * FROM purchase_order_items WHERE purchase_order_id = ?
            `, [reception[0].purchase_order_id]);

            const allReceived = poItems.every(poi =>
                poi.quantity_received >= poi.quantity_ordered
            );

            if (allReceived) {
                await pool.query(
                    'UPDATE purchase_orders SET status = ? WHERE id = ?',
                    ['received', reception[0].purchase_order_id]
                );
            } else {
                await pool.query(
                    'UPDATE purchase_orders SET status = ? WHERE id = ?',
                    ['partial', reception[0].purchase_order_id]
                );
            }
        }

        const [updated] = await pool.query('SELECT * FROM receptions WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== QUALITY CHECKS ====================

app.post('/api/quality-checks', async (req, res) => {
    const { reception_id, product_id, inspector_id, result, quantity_checked,
        quantity_passed, quantity_failed, defect_description, action_taken, notes } = req.body;
    const id = crypto.randomUUID();

    try {
        await pool.query(`
            INSERT INTO quality_checks
            (id, reception_id, product_id, inspector_id, result, quantity_checked,
             quantity_passed, quantity_failed, defect_description, action_taken, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, reception_id, product_id, inspector_id, result, quantity_checked,
            quantity_passed, quantity_failed, defect_description, action_taken, notes]);

        // Update reception item with rejection info if failed
        if (quantity_failed > 0) {
            await pool.query(`
                UPDATE reception_items
                SET quantity_rejected = ?, rejection_reason = ?
                WHERE reception_id = ? AND product_id = ?
            `, [quantity_failed, defect_description, reception_id, product_id]);
        }

        const [newQC] = await pool.query('SELECT * FROM quality_checks WHERE id = ?', [id]);
        res.json(newQC[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});




// ==================== INVOICING SYSTEM ====================

// Get tax conditions
app.get('/api/tax-conditions', async (req, res) => {
    try {
        const [conditions] = await pool.query('SELECT * FROM tax_conditions ORDER BY code');
        res.json(conditions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get invoices
app.get('/api/invoices', async (req, res) => {
    try {
        let query = `
            SELECT 
                i.id, i.order_id, i.issue_date, i.invoice_type, i.point_of_sale, i.invoice_number, 
                i.client_name, i.client_tax_id, i.client_tax_condition, i.client_address,
                i.net_amount, i.vat_amount, i.total_amount, i.status, i.cae, i.notes,
                JSON_OBJECT('name', i.client_name, 'tax_id', i.client_tax_id, 'tax_condition', i.client_tax_condition) as client_snapshot
            FROM invoices i
            
            UNION ALL
            
            SELECT 
                CONCAT('tkt-', o.id) as id, o.id as order_id, o.created_at as issue_date, 'TK' as invoice_type, 0 as point_of_sale, 0 as invoice_number,
                o.customer_name as client_name, '99-99999999-9' as client_tax_id, 'Consumidor Final' as client_tax_condition, 'Sin dirección' as client_address,
                o.total_amount / 1.21 as net_amount, o.total_amount - (o.total_amount / 1.21) as vat_amount, o.total_amount, 'issued' as status,
                NULL as cae, 'Ticket de Venta (No Fiscal)' as notes,
                JSON_OBJECT('name', o.customer_name, 'tax_id', '99-99999999-9', 'tax_condition', 'Consumidor Final') as client_snapshot
            FROM orders o
            WHERE NOT EXISTS (SELECT 1 FROM invoices i2 WHERE i2.order_id = o.id)
            
            ORDER BY issue_date DESC, invoice_number DESC LIMIT 100
        `;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create Invoice
app.post('/api/invoices', async (req, res) => {
    console.log('--- NEW INVOICE REQUEST ---', req.body);
    const {
        client_id, invoice_type, point_of_sale,
        items, order_id, notes, created_by
    } = req.body;

    // Get connection for transaction
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();


        // 1. Get client data for snapshot
        let client;
        let taxConditionName = 'Consumidor Final';

        if (client_id && client_id !== 'default-consumer-id') {
            const [clients] = await connection.query(
                'SELECT * FROM clients WHERE id = ?', [client_id]
            );
            if (clients.length > 0) {
                client = clients[0];
                // Get Tax Condition Name
                const [taxConds] = await connection.query(
                    'SELECT * FROM tax_conditions WHERE id = ?', [client.tax_condition_id]
                );
                taxConditionName = taxConds[0]?.name || 'Consumidor Final';
            }
        }

        // Fallback to anonymous client if not found or not provided
        if (!client) {
            client = {
                id: null,
                name: 'Consumidor Final',
                tax_id: '99-99999999-9',
                cuit: '99-99999999-9',
                address: 'Dirección no especificada'
            };
        }

        // 2. Calculate totals
        let net_amount = 0;
        let vat_amount = 0;
        let total_amount = 0;

        const invoiceItems = items.map(item => {
            const unitPrice = parseFloat(item.unit_price || 0);
            const qty = parseFloat(item.quantity || 0);
            const discount = parseFloat(item.discount || 0);
            const vatRate = parseFloat(item.vat_rate || 21);

            const subtotal = (unitPrice * qty) - discount;
            const vat = subtotal * (vatRate / 100);
            const total = subtotal + vat;

            net_amount += subtotal;
            vat_amount += vat;
            total_amount += total;

            return {
                ...item,
                unit_price: unitPrice,
                vat_amount: vat,
                total_line: total
            };
        });

        // 3. Generate Next Invoice Number for this Type/POS
        const [lastInvoice] = await connection.query(
            'SELECT MAX(invoice_number) as max_num FROM invoices WHERE invoice_type = ? AND point_of_sale = ?',
            [invoice_type, point_of_sale]
        );
        const nextNumber = (lastInvoice[0].max_num || 0) + 1;

        // 4. Create Invoice Header
        const invoiceId = crypto.randomUUID();
        await connection.query(`
            INSERT INTO invoices 
            (id, order_id, client_id, client_name, client_tax_id, client_address, client_tax_condition,
             invoice_type, point_of_sale, invoice_number, 
             net_amount, vat_amount, total_amount, status, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        `, [
            invoiceId, order_id || null, client.id, client.name, client.tax_id || client.cuit || '99-99999999-9', client.address || 'Sin dirección', taxConditionName,
            invoice_type, point_of_sale, nextNumber,
            net_amount, vat_amount, total_amount, (notes && notes.trim() !== '') ? notes : null, created_by && created_by !== 'admin' && created_by !== 'system' && created_by.length === 36 ? created_by : '00000000-0000-0000-0000-000000000000'
        ]);

        // 5. Create Invoice Items
        for (const item of invoiceItems) {
            await connection.query(`
                INSERT INTO invoice_items
                (id, invoice_id, product_id, description, quantity, unit_price, discount_percentage, vat_rate, vat_amount, total_line)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(), invoiceId, item.product_id, item.description,
                item.quantity, item.unit_price, item.discount || 0,
                item.vat_rate, item.vat_amount, item.total_line
            ]);
        }

        await connection.commit();

        // Return created invoice
        const [newInvoice] = await connection.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        res.status(201).json(newInvoice[0]);

    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// Authorize Invoice (AFIP Simulation)
app.post('/api/invoices/:id/authorize', async (req, res) => {
    const { id } = req.params;
    try {
        const cae = Math.floor(Math.random() * 90000000000000) + 10000000000000;
        const expiration = new Date();
        expiration.setDate(expiration.getDate() + 10);

        await pool.query(`
            UPDATE invoices 
            SET status = 'authorized', cae = ?, cae_expiration_date = ?
            WHERE id = ?
        `, [cae.toString(), expiration, id]);

        const [updated] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== CASH MANAGEMENT ====================

// Get all registers
app.get('/api/cash-registers', async (req, res) => {
    try {
        const [registers] = await pool.query(`
            SELECT cr.*, cs.opened_at, cs.opened_by, cs.opening_balance
            FROM cash_registers cr
            LEFT JOIN cash_shifts cs ON cr.current_shift_id = cs.id
        `);
        res.json(registers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current open shift for a specific register
app.get('/api/cash-registers/:id/shift', async (req, res) => {
    const { id } = req.params;
    try {
        const [shifts] = await pool.query(`
            SELECT cs.*, u.name as opener_name
            FROM cash_shifts cs
            JOIN users u ON cs.opened_by = u.id
            WHERE cs.cash_register_id = ? AND cs.status = 'open'
            LIMIT 1
        `, [id]);

        if (shifts.length === 0) {
            return res.status(404).json({ error: 'no_open_shift', message: 'No hay un turno abierto para esta caja' });
        }

        // Calculate expected balance from payments
        const [payments] = await pool.query(`
            SELECT SUM(amount) as total FROM shift_payments WHERE shift_id = ?
        `, [shifts[0].id]);

        const currentTotal = parseFloat(shifts[0].opening_balance) + parseFloat(payments[0].total || 0);
        res.json({ ...shifts[0], expected_balance: currentTotal });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Open a new shift
app.post('/api/cash-registers/:id/open', async (req, res) => {
    const { id } = req.params;
    const { opening_balance, opened_by } = req.body;
    const shiftId = crypto.randomUUID();
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Check if already open
        const [reg] = await connection.query('SELECT status FROM cash_registers WHERE id = ?', [id]);
        if (reg[0].status === 'open') {
            throw new Error('La caja ya se encuentra abierta');
        }

        // 2. Create Shift
        await connection.query(`
            INSERT INTO cash_shifts (id, cash_register_id, opened_by, opening_balance, status)
            VALUES (?, ?, ?, ?, 'open')
        `, [shiftId, id, opened_by || '00000000-0000-0000-0000-000000000000', opening_balance]);

        // 3. Update Register
        await connection.query(`
            UPDATE cash_registers SET status = 'open', current_shift_id = ? WHERE id = ?
        `, [shiftId, id]);

        await connection.commit();
        res.json({ id: shiftId, status: 'open' });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// Close a shift
app.post('/api/cash-shifts/:id/close', async (req, res) => {
    const { id } = req.params;
    const { actual_balance, closed_by, notes } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Get shift info
        const [shift] = await connection.query('SELECT * FROM cash_shifts WHERE id = ?', [id]);
        if (!shift[0] || shift[0].status === 'closed') throw new Error('Turno no válido o ya cerrado');

        // 2. Calculate totals
        const [payments] = await connection.query('SELECT SUM(amount) as total FROM shift_payments WHERE shift_id = ?', [id]);
        const expected = parseFloat(shift[0].opening_balance) + parseFloat(payments[0].total || 0);
        const diff = parseFloat(actual_balance) - expected;

        // 3. Update Shift
        await connection.query(`
            UPDATE cash_shifts 
            SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, 
                expected_balance = ?, actual_balance = ?, difference = ?, notes = ?
            WHERE id = ?
        `, [closed_by || '00000000-0000-0000-0000-000000000000', expected, actual_balance, diff, notes, id]);

        // 4. Update Register
        await connection.query(`
            UPDATE cash_registers SET status = 'closed', current_shift_id = NULL 
            WHERE id = ?
        `, [shift[0].cash_register_id]);

        await connection.commit();
        res.json({ success: true, difference: diff });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// Add payment to shift
app.post('/api/cash-shifts/:id/payments', async (req, res) => {
    const { id } = req.params;
    const { order_id, payment_method, amount, type } = req.body;
    try {
        await pool.query(`
            INSERT INTO shift_payments (id, shift_id, order_id, payment_method, amount, type)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [crypto.randomUUID(), id, order_id || null, payment_method, amount, type || 'sale']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
console.log("File execution reached the end");
