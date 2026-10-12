-- Accounts used by the complete posting of payments and adjustments (simulation 2026-10-12):
-- card/QR receipts are not cash in the drawer, and non-sale cash income needs its own account.
INSERT IGNORE INTO chart_of_accounts (code, name, type)
VALUES ('1.1.02.03', 'Tarjetas y QR a cobrar', 'asset');
INSERT IGNORE INTO chart_of_accounts (code, name, type)
VALUES ('4.2.01.01', 'Otros ingresos', 'revenue');
