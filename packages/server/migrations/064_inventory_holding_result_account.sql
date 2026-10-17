-- ADR-027 (usuario, 2026-10-17): a new cost on goods already in stock revalues them. The
-- difference goes to the holding result (resultado por tenencia), so the ledger keeps matching
-- stock times cost. Only an account: no data changes.
-- (No semicolons in comments: the migration runner splits statements on them.)
INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES
    ('4.2.02.01', 'Resultado por tenencia de mercaderías', 'revenue');
