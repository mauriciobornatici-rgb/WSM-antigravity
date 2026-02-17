import pool from './server/db.js';

const recreateSettings = async () => {
    try {
        console.log("Dropping old company_settings table...");
        await pool.query('DROP TABLE IF EXISTS company_settings');

        console.log("Creating new company_settings table...");
        await pool.query(`
            CREATE TABLE company_settings (
                id INT PRIMARY KEY,
                brand_name VARCHAR(255),
                legal_name VARCHAR(255),
                tax_id VARCHAR(50),
                logo_url VARCHAR(500),
                contact_phone VARCHAR(50),
                contact_email VARCHAR(255),
                contact_website VARCHAR(255),
                address_street VARCHAR(255),
                address_city VARCHAR(100),
                social_instagram VARCHAR(255),
                social_facebook VARCHAR(255),
                social_linkedin VARCHAR(255)
            )
        `);

        console.log("Inserting default settings...");
        await pool.query(`
            INSERT INTO company_settings (id, brand_name, legal_name, tax_id, logo_url, contact_phone, contact_email, contact_website, address_street, address_city, social_instagram, social_facebook, social_linkedin)
            VALUES (1, 'SportsERP Demo', 'Antigravity Systems S.A.', '30-12345678-9', '', '+54 11 1234-5678', 'contacto@sports.store', 'www.sports.store', 'Av. Corrientes 1234', 'CABA', 'sports.erp', 'SportsERP', 'antigravity-systems')
        `);

        console.log("Done! Verifying...");
        const [rows] = await pool.query('SELECT * FROM company_settings');
        console.log("Current settings:", rows);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
};

recreateSettings();
