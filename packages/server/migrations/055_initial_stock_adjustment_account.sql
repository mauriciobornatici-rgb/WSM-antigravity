-- ADR-018 (usuario, 2026-10-12): goods the business already had enter inventory against an
-- adjustment account, not against share capital.
-- (No semicolons in comments: the migration runner splits statements on them.)
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('3.1.03.01', 'Ajuste por inventario inicial', 'equity');
