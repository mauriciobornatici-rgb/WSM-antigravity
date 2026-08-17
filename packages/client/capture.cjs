const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WORKSPACE_IMAGES = 'c:\\Dev\\ERP\\WSM Tienda Deportes\\manual_images';
const ARTIFACT_IMAGES = 'C:\\Users\\mauri\\.gemini\\antigravity\\brain\\00293141-64a7-44dc-aa92-904f76fd71e2\\manual_images';

[WORKSPACE_IMAGES, ARTIFACT_IMAGES].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const routes = [
    { url: 'http://localhost:5173/login', name: '01_login.png' },
    { url: 'http://localhost:5173/', name: '02_dashboard.png' },
    { url: 'http://localhost:5173/settings', name: '03_settings.png' },
    { url: 'http://localhost:5173/inventory', name: '04_inventory.png' },
    { url: 'http://localhost:5173/suppliers', name: '05_suppliers.png' },
    { url: 'http://localhost:5173/purchase-orders', name: '06_purchase_orders.png' },
    { url: 'http://localhost:5173/receptions', name: '07_receptions.png' },
    { url: 'http://localhost:5173/pos', name: '08_pos.png' },
    { url: 'http://localhost:5173/orders', name: '09_orders.png' },
    { url: 'http://localhost:5173/invoices', name: '10_invoices.png' },
    { url: 'http://localhost:5173/collections', name: '11_collections.png' },
    { url: 'http://localhost:5173/supplier-payments', name: '12_supplier_payments.png' },
    { url: 'http://localhost:5173/current-accounts', name: '13_current_accounts.png' },
    { url: 'http://localhost:5173/cash-management', name: '14_cash_management.png' },
    { url: 'http://localhost:5173/returns-warranties', name: '15_returns_warranties.png' },
    { url: 'http://localhost:5173/accounting', name: '16_accounting.png' }
];

async function capture() {
    console.log('Iniciando Puppeteer Core en CommonJS...');
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        defaultViewport: { width: 1440, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Login via API to get auth token
    await page.goto('http://localhost:5173/login');
    await page.evaluate(async () => {
        const res = await fetch('http://localhost:3001/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@sports.store', password: 'Password123!' })
        });
        const data = await res.json();
        if (data.token) {
            localStorage.setItem('sports_erp_auth', JSON.stringify({ token: data.token }));
            localStorage.setItem('sports_erp_user', JSON.stringify(data.user));
        }
    });

    for (const r of routes) {
        console.log(`Capturando ${r.name}...`);
        await page.goto(r.url, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 800));
        const wsPath = path.join(WORKSPACE_IMAGES, r.name);
        const artPath = path.join(ARTIFACT_IMAGES, r.name);
        await page.screenshot({ path: wsPath, fullPage: false });
        fs.copyFileSync(wsPath, artPath);
        console.log(`Saved ${r.name}`);
    }

    await browser.close();
    console.log('Todas las capturas se guardaron exitosamente.');
}

capture().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
