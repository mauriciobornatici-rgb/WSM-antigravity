const pool = require('./server/db');

async function addLocationColumn() {
    try {
        console.log('Checking database connection...');
        const [test] = await pool.query('SELECT 1 as val');
        console.log('Connected to database successfully');

        console.log('Checking if location column exists...');
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'products' 
            AND COLUMN_NAME = 'location'
        `);

        if (columns.length === 0) {
            console.log('Adding location column...');
            await pool.query('ALTER TABLE products ADD COLUMN location VARCHAR(100) AFTER image_url');
            console.log('✅ Location column added successfully!');
        } else {
            console.log('✅ Location column already exists');
        }
    } catch (error) {
        console.error(' Error:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

addLocationColumn();
