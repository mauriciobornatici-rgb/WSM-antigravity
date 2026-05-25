-- ============================================================
-- Accounting ledgers for Double-Entry Bookkeeping System
-- ============================================================

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id VARCHAR(36) PRIMARY KEY,
    entry_number INT AUTO_INCREMENT UNIQUE KEY,
    date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id VARCHAR(36) PRIMARY KEY,
    journal_entry_id VARCHAR(36) NOT NULL,
    account_code VARCHAR(50) NOT NULL,
    debit DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    credit DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_code) REFERENCES chart_of_accounts(code)
);

-- ============================================================
-- Baseline Seed for Chart of Accounts (Plan de Cuentas Standard)
-- ============================================================

INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
-- Assets (Activo)
('1.1.01.01', 'Caja Principal', 'asset'),
('1.1.02.01', 'Banco Nación C/C', 'asset'),
('1.1.03.01', 'Deudores por Ventas (Clientes Ctas Ctes)', 'asset'),
('1.1.04.01', 'Inventario de Mercaderías', 'asset'),
('1.1.05.01', 'IVA Crédito Fiscal (10.5%)', 'asset'),
('1.1.05.02', 'IVA Crédito Fiscal (21%)', 'asset'),
('1.1.05.03', 'IVA Crédito Fiscal (27%)', 'asset'),

-- Liabilities (Pasivo)
('2.1.01.01', 'Proveedores (Cuentas a Pagar)', 'liability'),
('2.1.02.01', 'IVA Débito Fiscal (10.5%)', 'liability'),
('2.1.02.02', 'IVA Débito Fiscal (21%)', 'liability'),
('2.1.02.03', 'IVA Débito Fiscal (27%)', 'liability'),

-- Equity (Patrimonio Neto)
('3.1.01.01', 'Capital Social', 'equity'),
('3.1.02.01', 'Resultados Acumulados', 'equity'),

-- Revenues (Ingresos)
('4.1.01.01', 'Ventas de Mercaderías', 'revenue'),

-- Expenses (Egresos)
('5.1.01.01', 'Costo de Mercaderías Vendidas (CMV)', 'expense'),
('5.1.02.01', 'Gastos Generales / Administrativos', 'expense'),
('5.1.02.02', 'Pérdidas por Faltantes de Inventario', 'expense');
