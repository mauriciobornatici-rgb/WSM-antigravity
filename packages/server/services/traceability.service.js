import pool from '../config/db.js';

function parseJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return { raw: value };
    }
}

function compactMetadata(metadata) {
    return Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
    );
}

function buildProductWhere(filters, alias = 'p') {
    const clauses = [];
    const params = [];

    if (filters.product_id) {
        clauses.push(`${alias}.id = ?`);
        params.push(filters.product_id);
    }
    if (filters.sku) {
        clauses.push(`${alias}.sku = ?`);
        params.push(filters.sku);
    }
    if (filters.barcode) {
        clauses.push(`${alias}.barcode = ?`);
        params.push(filters.barcode);
    }

    if (clauses.length === 0) {
        const error = new Error('At least one traceability filter is required');
        error.statusCode = 400;
        error.errorCode = 'TRACEABILITY_FILTER_REQUIRED';
        throw error;
    }

    return { where: clauses.join(' AND '), params };
}

function eventDate(value) {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export class TraceabilityService {
    constructor(queryExecutor = pool) {
        this.db = queryExecutor;
    }

    async getTimeline(filters = {}) {
        const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
        const [
            movementEvents,
            batchEvents,
            serialEvents,
            auditEvents,
            orderEvents,
            invoiceEvents,
            clientReturnEvents,
            warrantyEvents,
            supplierReturnEvents
        ] = await Promise.all([
            this.getInventoryMovementEvents(filters),
            this.getBatchEvents(filters),
            this.getSerialEvents(filters),
            this.getAuditEvents(filters),
            this.getOrderEvents(filters),
            this.getInvoiceEvents(filters),
            this.getClientReturnEvents(filters),
            this.getWarrantyEvents(filters),
            this.getSupplierReturnEvents(filters)
        ]);

        return [
            ...movementEvents,
            ...batchEvents,
            ...serialEvents,
            ...auditEvents,
            ...orderEvents,
            ...invoiceEvents,
            ...clientReturnEvents,
            ...warrantyEvents,
            ...supplierReturnEvents
        ]
            .sort((a, b) => eventDate(b.occurred_at) - eventDate(a.occurred_at))
            .slice(0, limit);
    }

    async getInventoryMovementEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT im.*, p.name AS product_name, p.sku, u.name AS user_name
             FROM inventory_movements im
             JOIN products p ON p.id = im.product_id
             LEFT JOIN users u ON u.id = im.performed_by
             WHERE ${where}
             ORDER BY im.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `inventory_movements:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'inventory_movement',
            title: this.inventoryMovementTitle(row),
            description: this.inventoryMovementDescription(row),
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: Number(row.quantity || 0),
            from_location: row.from_location || null,
            to_location: row.to_location || null,
            reference_type: row.reference_type || null,
            reference_id: row.reference_id || null,
            actor_name: row.user_name || null,
            source_table: 'inventory_movements',
            metadata: compactMetadata({
                movement_type: row.type,
                unit_cost: row.unit_cost != null ? Number(row.unit_cost) : undefined,
                reason: row.reason,
                notes: row.notes
            })
        }));
    }

    async getBatchEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT b.*, p.name AS product_name, p.sku
             FROM product_batches b
             JOIN products p ON p.id = b.product_id
             WHERE ${where}
             ORDER BY b.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `product_batches:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'batch',
            title: `Lote ${row.batch_number}`,
            description: `Lote ${row.batch_number} con ${Number(row.quantity_current || 0)} unidades actuales en ${row.location || 'Sin ubicacion'}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: Number(row.quantity_current || 0),
            from_location: null,
            to_location: row.location || null,
            reference_type: 'batch',
            reference_id: row.id,
            actor_name: null,
            source_table: 'product_batches',
            metadata: compactMetadata({
                batch_number: row.batch_number,
                supplier_id: row.supplier_id,
                quantity_initial: row.quantity_initial != null ? Number(row.quantity_initial) : undefined,
                status: row.status,
                expiration_date: row.expiration_date
            })
        }));
    }

    async getSerialEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT s.*, p.name AS product_name, p.sku
             FROM serial_numbers s
             JOIN products p ON p.id = s.product_id
             WHERE ${where}
             ORDER BY s.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `serial_numbers:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'serial',
            title: `Serie ${row.serial_number}`,
            description: `Serie ${row.serial_number} en estado ${row.status || 'sin estado'}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: 1,
            from_location: null,
            to_location: row.location || null,
            reference_type: 'serial',
            reference_id: row.id,
            actor_name: null,
            source_table: 'serial_numbers',
            metadata: compactMetadata({
                serial_number: row.serial_number,
                batch_id: row.batch_id,
                status: row.status,
                sold_to_client_id: row.sold_to_client_id,
                sold_in_order_id: row.sold_in_order_id,
                warranty_expiration: row.warranty_expiration
            })
        }));
    }

    async getAuditEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT al.*, p.name AS product_name, p.sku, u.name AS user_name
             FROM audit_logs al
             JOIN products p ON p.id = al.entity_id AND al.entity_type = 'product'
             LEFT JOIN users u ON u.id = al.user_id
             WHERE ${where}
             ORDER BY al.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `audit_logs:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'audit',
            title: row.action,
            description: `${row.action} sobre producto ${row.sku}`,
            product_id: row.entity_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: null,
            from_location: null,
            to_location: null,
            reference_type: row.entity_type,
            reference_id: row.entity_id,
            actor_name: row.user_name || null,
            source_table: 'audit_logs',
            metadata: compactMetadata({
                old_values: parseJson(row.old_values),
                new_values: parseJson(row.new_values),
                ip_address: row.ip_address
            })
        }));
    }

    async getOrderEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT oi.*, p.name AS product_name, p.sku,
                    o.created_at, o.customer_name, o.status AS order_status,
                    o.payment_status, o.shipping_method, o.tracking_number,
                    o.total_amount AS order_total
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             WHERE ${where}
               AND o.deleted_at IS NULL
             ORDER BY o.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `order_items:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'order',
            title: `Pedido ${row.order_id}`,
            description: `Pedido de ${Number(row.quantity || 0)} unidades para ${row.customer_name || 'cliente sin nombre'}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: Number(row.quantity || 0),
            from_location: null,
            to_location: null,
            reference_type: 'order',
            reference_id: row.order_id,
            actor_name: null,
            source_table: 'order_items',
            metadata: compactMetadata({
                customer_name: row.customer_name,
                order_status: row.order_status,
                payment_status: row.payment_status,
                shipping_method: row.shipping_method,
                tracking_number: row.tracking_number,
                unit_price: row.unit_price != null ? Number(row.unit_price) : undefined,
                subtotal: row.subtotal != null ? Number(row.subtotal) : undefined,
                order_total: row.order_total != null ? Number(row.order_total) : undefined
            })
        }));
    }

    async getInvoiceEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT ii.*, p.name AS product_name, p.sku,
                    i.issue_date, i.created_at, i.client_name,
                    i.invoice_type, i.point_of_sale, i.invoice_number,
                    i.status AS invoice_status, i.payment_status,
                    i.total_amount AS invoice_total
             FROM invoice_items ii
             JOIN invoices i ON i.id = ii.invoice_id
             JOIN products p ON p.id = ii.product_id
             WHERE ${where}
               AND i.deleted_at IS NULL
             ORDER BY i.issue_date DESC`,
            params
        );

        return rows.map((row) => ({
            id: `invoice_items:${row.id}`,
            occurred_at: row.issue_date || row.created_at,
            event_type: 'invoice',
            title: `Factura ${this.invoiceDisplayNumber(row)}`,
            description: `Facturacion de ${Number(row.quantity || 0)} unidades a ${row.client_name || 'cliente sin nombre'}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: Number(row.quantity || 0),
            from_location: null,
            to_location: null,
            reference_type: 'invoice',
            reference_id: row.invoice_id,
            actor_name: null,
            source_table: 'invoice_items',
            metadata: compactMetadata({
                client_name: row.client_name,
                invoice_type: row.invoice_type,
                point_of_sale: row.point_of_sale,
                invoice_number: row.invoice_number,
                invoice_status: row.invoice_status,
                payment_status: row.payment_status,
                unit_price: row.unit_price != null ? Number(row.unit_price) : undefined,
                total_line: row.total_line != null ? Number(row.total_line) : undefined,
                invoice_total: row.invoice_total != null ? Number(row.invoice_total) : undefined
            })
        }));
    }

    async getClientReturnEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT cri.*, p.name AS product_name, p.sku,
                    cr.created_at, cr.customer_name, cr.order_id,
                    cr.status AS return_status, cr.reason,
                    cr.total_amount AS return_total
             FROM client_return_items cri
             JOIN client_returns cr ON cr.id = cri.return_id
             JOIN products p ON p.id = cri.product_id
             WHERE ${where}
               AND cr.deleted_at IS NULL
             ORDER BY cr.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `client_return_items:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'client_return',
            title: 'Devolucion de cliente',
            description: `Devolucion de ${Number(row.quantity || 0)} unidades de ${row.customer_name || 'cliente sin nombre'}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: Number(row.quantity || 0),
            from_location: null,
            to_location: null,
            reference_type: 'client_return',
            reference_id: row.return_id,
            actor_name: null,
            source_table: 'client_return_items',
            metadata: compactMetadata({
                customer_name: row.customer_name,
                order_id: row.order_id,
                return_status: row.return_status,
                reason: row.reason,
                condition_status: row.condition_status,
                unit_price: row.unit_price != null ? Number(row.unit_price) : undefined,
                return_total: row.return_total != null ? Number(row.return_total) : undefined
            })
        }));
    }

    async getWarrantyEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT wc.*, p.name AS product_name, p.sku
             FROM warranty_claims wc
             JOIN products p ON p.id = wc.product_id
             WHERE ${where}
               AND wc.deleted_at IS NULL
             ORDER BY wc.created_at DESC`,
            params
        );

        return rows.map((row) => ({
            id: `warranty_claims:${row.id}`,
            occurred_at: row.created_at,
            event_type: 'warranty',
            title: row.serial_number ? `Garantia ${row.serial_number}` : 'Garantia',
            description: `Garantia ${row.status || 'sin estado'} para ${row.customer_name || 'cliente sin nombre'}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: 1,
            from_location: null,
            to_location: null,
            reference_type: 'warranty',
            reference_id: row.id,
            actor_name: null,
            source_table: 'warranty_claims',
            metadata: compactMetadata({
                customer_name: row.customer_name,
                serial_number: row.serial_number,
                issue_description: row.issue_description,
                status: row.status,
                resolution_type: row.resolution_type,
                resolution_notes: row.resolution_notes
            })
        }));
    }

    async getSupplierReturnEvents(filters) {
        const { where, params } = buildProductWhere(filters, 'p');
        const [rows] = await this.db.query(
            `SELECT sri.*, p.name AS product_name, p.sku,
                    sr.return_number, sr.date, sr.status AS return_status,
                    sr.notes, s.name AS supplier_name
             FROM supplier_return_items sri
             JOIN supplier_returns sr ON sr.id = sri.return_id
             JOIN products p ON p.id = sri.product_id
             LEFT JOIN suppliers s ON s.id = sr.supplier_id
             WHERE ${where}
             ORDER BY sr.date DESC`,
            params
        );

        return rows.map((row) => ({
            id: `supplier_return_items:${row.id}`,
            occurred_at: row.date,
            event_type: 'supplier_return',
            title: `Devolucion a proveedor ${row.return_number || row.return_id}`,
            description: `Devolucion de ${Number(row.quantity || 0)} unidades a ${row.supplier_name || 'proveedor sin nombre'}${row.reason ? ` por ${row.reason}` : ''}`,
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity: Number(row.quantity || 0),
            from_location: null,
            to_location: null,
            reference_type: 'supplier_return',
            reference_id: row.return_id,
            actor_name: null,
            source_table: 'supplier_return_items',
            metadata: compactMetadata({
                return_number: row.return_number,
                supplier_name: row.supplier_name,
                return_status: row.return_status,
                reason: row.reason,
                notes: row.notes,
                unit_cost: row.unit_cost != null ? Number(row.unit_cost) : undefined
            })
        }));
    }

    inventoryMovementTitle(row) {
        const labels = {
            initial_stock: 'Stock inicial',
            receipt: 'Recepcion de stock',
            sale: 'Venta',
            return: 'Devolucion',
            transfer: 'Transferencia interna',
            adjustment: 'Ajuste de inventario',
            supplier_return: 'Devolucion a proveedor'
        };
        return labels[row.type] || row.type || 'Movimiento de inventario';
    }

    inventoryMovementDescription(row) {
        const quantity = Number(row.quantity || 0);
        const movementType = row.type || 'movimiento';
        if (row.from_location && row.to_location) {
            return `${movementType} de ${quantity} unidades desde ${row.from_location} hacia ${row.to_location}`;
        }
        if (row.to_location) {
            return `${movementType} de ${quantity} unidades hacia ${row.to_location}`;
        }
        if (row.from_location) {
            return `${movementType} de ${quantity} unidades desde ${row.from_location}`;
        }
        return `${movementType} de ${quantity} unidades`;
    }

    invoiceDisplayNumber(row) {
        const pointOfSale = String(row.point_of_sale || 0).padStart(4, '0');
        const invoiceNumber = String(row.invoice_number || 0).padStart(8, '0');
        return `${row.invoice_type || 'S/T'}-${pointOfSale}-${invoiceNumber}`;
    }
}

export default new TraceabilityService();
