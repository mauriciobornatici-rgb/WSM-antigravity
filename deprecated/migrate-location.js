import pool from './server/db.js';

async function migrate() {
    try {
        console.log('Conectando a la base de datos...');

        await pool.query(`
            ALTER TABLE products 
            ADD COLUMN location VARCHAR(100) AFTER image_url
        `);

        console.log('✅ Columna location agregada exitosamente!');
        process.exit(0);
    } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
            console.log('✅ La columna location ya existe');
            process.exit(0);
        } else {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    }
}

migrate();
