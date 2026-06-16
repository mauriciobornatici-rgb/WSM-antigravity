-- Ensure products table has supplier_id column (some historical dev instances might be missing it)
SET @dbname = DATABASE();
SET @tablename = 'products';
SET @columnname = 'supplier_id';
SET @preparedStatement = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @dbname
       AND TABLE_NAME = @tablename
       AND COLUMN_NAME = @columnname) > 0,
    'SELECT 1',
    'ALTER TABLE products ADD COLUMN supplier_id VARCHAR(36) NULL'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
