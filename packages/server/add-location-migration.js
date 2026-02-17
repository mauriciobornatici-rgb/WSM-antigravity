const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Checking if location column exists...');

        const [columns] = await connection.execute(
            'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [process.env.DB_NAME, 'products', 'location']
        );

        if (columns.length === 0) {
            console.log('Adding location column to products table...');
            await connection.execute('ALTER TABLE products ADD COLUMN location VARCHAR(100) AFTER image_url');
            console.log('✅ Location column added successfully!');
        } else {
            console.log('✅ Location column already exists');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) await connection.end();
    }
}

run();
