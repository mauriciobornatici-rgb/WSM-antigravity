import pool from './server/db.js';

const seedSettings = async () => {
    try {
        console.log("Seeding company_settings...");
        await pool.query(`
            INSERT INTO company_settings (id, brand_name, legal_name, tax_id, logo_url, contact_phone, contact_email, contact_website, address_street, address_city, social_instagram, social_facebook, social_linkedin)
            VALUES (1, 'SportsERP Demo', 'Antigravity Systems S.A.', '30-12345678-9', '', '+54 11 1234-5678', 'contacto@sports.store', 'www.sports.store', 'Av. Corrientes 1234', 'CABA', 'sports.erp', 'SportsERP', 'antigravity-systems')
            ON DUPLICATE KEY UPDATE
                brand_name = 'SportsERP Demo',
                legal_name = 'Antigravity Systems S.A.',
                tax_id = '30-12345678-9'
        `);
        console.log("Settings seeded successfully.");

        const [rows] = await pool.query('SELECT * FROM company_settings');
        console.log("Current settings:", rows);
    } catch (error) {
        console.error('Error seeding settings:', error);
    } finally {
        process.exit();
    }
};

seedSettings();
