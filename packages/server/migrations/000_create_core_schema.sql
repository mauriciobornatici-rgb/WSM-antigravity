-- ============================================================
-- Core runtime schema bootstrap (deterministic fresh install)
-- Canonical source: migrations/*.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'cashier',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS company_settings (
    id INT PRIMARY KEY,
    brand_name VARCHAR(255),
    legal_name VARCHAR(255),
    tax_id VARCHAR(50),
    logo_url VARCHAR(500),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    contact_website VARCHAR(255),
    address_street VARCHAR(255),
    address_city VARCHAR(255),
    social_instagram VARCHAR(255),
    social_facebook VARCHAR(255),
    social_linkedin VARCHAR(255),
    tax_rate DECIMAL(5, 4) DEFAULT 0.2100,
    default_currency VARCHAR(3) DEFAULT 'ARS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    tax_id VARCHAR(50),
    address TEXT,
    credit_limit DECIMAL(15, 2) DEFAULT 0,
    current_account_balance DECIMAL(15, 2) DEFAULT 0,
    city VARCHAR(100),
    state VARCHAR(100),
    type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),
    contact_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    active BOOLEAN DEFAULT TRUE,
    category VARCHAR(100),
    rating INT DEFAULT 0,
    account_balance DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(36) PRIMARY KEY,
    sku VARCHAR(100) UNIQUE,
    barcode VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    image_url TEXT,
    location VARCHAR(100),
    brand VARCHAR(100),
    unit_measure VARCHAR(50) DEFAULT 'unit',
    purchase_price DECIMAL(15, 2) DEFAULT 0,
    cost_price DECIMAL(15, 2) DEFAULT 0,
    sale_price DECIMAL(15, 2) DEFAULT 0,
    stock_current INT DEFAULT 0,
    stock_min INT DEFAULT 0,
    supplier_id VARCHAR(36),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS inventory (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    location VARCHAR(100) NOT NULL DEFAULT 'General',
    quantity INT DEFAULT 0,
    min_stock_level INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uq_inventory_product_location (product_id, location)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
    id VARCHAR(36) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    quantity INT NOT NULL,
    unit_cost DECIMAL(15, 2) DEFAULT 0,
    reason VARCHAR(255),
    reference_type VARCHAR(50),
    reference_id VARCHAR(100),
    notes TEXT,
    performed_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_batches (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    manufacturing_date DATE,
    expiration_date DATE,
    supplier_id VARCHAR(36),
    reception_id VARCHAR(36),
    quantity_initial INT NOT NULL,
    quantity_current INT NOT NULL,
    location VARCHAR(100),
    status VARCHAR(30) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_product_batch (product_id, batch_number)
);

CREATE TABLE IF NOT EXISTS serial_numbers (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    serial_number VARCHAR(255) NOT NULL UNIQUE,
    batch_id VARCHAR(36),
    location VARCHAR(100),
    status VARCHAR(30) DEFAULT 'available',
    sold_to_client_id VARCHAR(36),
    sold_in_order_id VARCHAR(36),
    sale_date DATETIME,
    warranty_expiration DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    description TEXT,
    reference_id VARCHAR(100),
    client_id VARCHAR(36),
    supplier_id VARCHAR(36),
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36),
    customer_name VARCHAR(255),
    total_amount DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'pending',
    payment_status VARCHAR(30) DEFAULT 'pending',
    payment_method VARCHAR(50) DEFAULT 'cash',
    shipping_method VARCHAR(20),
    shipping_address TEXT,
    tracking_number VARCHAR(100),
    estimated_delivery DATETIME,
    dispatched_at DATETIME,
    delivered_at DATETIME,
    recipient_name VARCHAR(255),
    recipient_dni VARCHAR(100),
    delivery_notes TEXT,
    invoice_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    picked_quantity INT DEFAULT 0,
    unit_price DECIMAL(15, 2) NOT NULL,
    subtotal DECIMAL(15, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id VARCHAR(36) PRIMARY KEY,
    supplier_id VARCHAR(36) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(100),
    reference_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id VARCHAR(36) PRIMARY KEY,
    po_number VARCHAR(100) UNIQUE NOT NULL,
    supplier_id VARCHAR(36) NOT NULL,
    order_date DATE NOT NULL,
    expected_delivery_date DATE,
    status VARCHAR(30) DEFAULT 'draft',
    subtotal DECIMAL(15, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    notes TEXT,
    created_by VARCHAR(36),
    approved_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id VARCHAR(36) PRIMARY KEY,
    purchase_order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity_ordered INT NOT NULL,
    quantity_received INT DEFAULT 0,
    unit_cost DECIMAL(15, 2) NOT NULL,
    subtotal DECIMAL(15, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receptions (
    id VARCHAR(36) PRIMARY KEY,
    reception_number VARCHAR(100) UNIQUE NOT NULL,
    purchase_order_id VARCHAR(36),
    supplier_id VARCHAR(36) NOT NULL,
    reception_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    remito_number VARCHAR(100),
    status VARCHAR(30) DEFAULT 'pending_qc',
    received_by VARCHAR(36),
    approved_by VARCHAR(36),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reception_items (
    id VARCHAR(36) PRIMARY KEY,
    reception_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    po_item_id VARCHAR(36),
    quantity_expected INT DEFAULT 0,
    quantity_received INT NOT NULL,
    quantity_approved INT DEFAULT 0,
    quantity_rejected INT DEFAULT 0,
    rejection_reason TEXT,
    location_assigned VARCHAR(100),
    batch_number VARCHAR(100),
    expiration_date DATE,
    unit_cost DECIMAL(15, 2) DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS quality_checks (
    id VARCHAR(36) PRIMARY KEY,
    reception_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    inspector_id VARCHAR(36),
    check_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    result VARCHAR(30) NOT NULL,
    quantity_checked INT DEFAULT 0,
    quantity_passed INT DEFAULT 0,
    quantity_failed INT DEFAULT 0,
    defect_description TEXT,
    photos TEXT,
    action_taken VARCHAR(50) DEFAULT 'approve',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tax_conditions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    code VARCHAR(10) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36),
    client_id VARCHAR(36),
    client_name VARCHAR(255) NOT NULL,
    client_tax_id VARCHAR(50),
    client_address TEXT,
    client_tax_condition VARCHAR(50),
    invoice_type VARCHAR(3) NOT NULL,
    point_of_sale INT NOT NULL,
    invoice_number INT NOT NULL,
    issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATE,
    cae VARCHAR(50),
    cae_expiration_date DATE,
    net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    exempt_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    status VARCHAR(30) DEFAULT 'draft',
    notes TEXT,
    created_by VARCHAR(36),
    customer_name VARCHAR(255),
    payment_method VARCHAR(50),
    payment_status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uq_invoice_number (invoice_type, point_of_sale, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id VARCHAR(36) PRIMARY KEY,
    invoice_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36),
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    discount_percentage DECIMAL(5, 2) DEFAULT 0,
    vat_rate DECIMAL(5, 2) DEFAULT 0,
    vat_amount DECIMAL(15, 2) DEFAULT 0,
    total_line DECIMAL(15, 2) DEFAULT 0,
    product_name VARCHAR(255),
    sku VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS cash_registers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    status VARCHAR(20) DEFAULT 'closed',
    current_shift_id VARCHAR(36),
    opened_at TIMESTAMP NULL,
    opening_balance DECIMAL(15, 2),
    expected_balance DECIMAL(15, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_shifts (
    id VARCHAR(36) PRIMARY KEY,
    cash_register_id VARCHAR(36) NOT NULL,
    opened_by VARCHAR(36),
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    closed_by VARCHAR(36),
    closed_at TIMESTAMP NULL,
    expected_balance DECIMAL(15, 2) DEFAULT 0,
    actual_balance DECIMAL(15, 2) DEFAULT 0,
    difference DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'open',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS shift_payments (
    id VARCHAR(36) PRIMARY KEY,
    shift_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36),
    payment_method VARCHAR(50) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    type VARCHAR(20) DEFAULT 'sale',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warranty_claims (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36),
    customer_name VARCHAR(255),
    product_id VARCHAR(36),
    serial_number VARCHAR(100),
    issue_description TEXT,
    status VARCHAR(50) DEFAULT 'initiated',
    resolution_type VARCHAR(50),
    resolution_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS client_returns (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36),
    customer_name VARCHAR(255),
    order_id VARCHAR(36),
    status VARCHAR(30) DEFAULT 'pending',
    total_amount DECIMAL(15, 2) DEFAULT 0,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS client_return_items (
    id VARCHAR(36) PRIMARY KEY,
    return_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    condition_status VARCHAR(50) DEFAULT 'sellable',
    unit_price DECIMAL(15, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_notes (
    id VARCHAR(36) PRIMARY KEY,
    number VARCHAR(50) UNIQUE NOT NULL,
    client_id VARCHAR(36),
    customer_name VARCHAR(255),
    reference_type VARCHAR(50),
    reference_id VARCHAR(36),
    amount DECIMAL(15, 2) NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(30) DEFAULT 'issued',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(36),
    old_values LONGTEXT NULL,
    new_values LONGTEXT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO tax_conditions (id, name, code) VALUES
('tc_RespInscripto', 'Responsable Inscripto', '01'),
('tc_Monotributo', 'Monotributista', '06'),
('tc_ConsFinal', 'Consumidor Final', '05'),
('tc_Exento', 'Exento', '04');

INSERT IGNORE INTO cash_registers (id, name, location, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Caja Principal', 'Mostrador Central', 'closed');
