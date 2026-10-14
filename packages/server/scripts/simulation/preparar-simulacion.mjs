// Carga los datos maestros de la SIMULACIÓN en la base `wsm_simulacion` a través de la API local,
// para que pasen por las mismas reglas que el uso real (stock inicial con costo y asiento,
// condiciones de IVA, permisos). No toca la base de desarrollo ni la de producción.
//
// La ejecuta `scripts/simulacion.ps1` después de crear la base y levantar la API sobre ella.
// Uso manual:  node packages/server/scripts/simulation/preparar-simulacion.mjs
//
// Credenciales de prueba (solo para esta base local de simulación): ver docs/execution/GUIA_SIMULACION.md
import mysql from 'mysql2/promise';

const API = process.env.SIM_API || 'http://localhost:3001';
const ORIGIN = process.env.SIM_ORIGIN || 'http://localhost:5173';
const DB_NAME = 'wsm_simulacion';
const DB = { host: '127.0.0.1', port: 3319, user: 'wsm_user', password: 'wsm_pass_2026', database: DB_NAME };
export const SIM_PASSWORD = 'Simulacion2026!';
const ADMIN = { email: 'admin@sports.store', password: SIM_PASSWORD };

let cookie = '';
async function call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, origin: ORIGIN },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(',').map((c) => c.split(';')[0].trim()).filter((c) => c.includes('=')).join('; ');
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
    return json;
}

// CUIT con dígito verificador válido (los de prueba son ficticios).
function cuit(prefix, body) {
    const digits = `${prefix}${body}`;
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const check = 11 - (sum % 11);
    if (check === 10) throw new Error(`CUIT de prueba inválido: ${digits}`);
    return `${prefix}-${body}-${check === 11 ? 0 : check}`;
}

const net = (finalPrice, vatRate = 21) => Math.round((finalPrice / (1 + vatRate / 100)) * 10000) / 10000;

const DEPOSITO = 'DEP-A1';
const SALON = 'SAL-01';

// Catálogo de una tienda de deportes: precio final con IVA (lo que paga el cliente) y costo neto.
const CATALOG = [
    ...['40', '41', '42', '43'].map((size) => ({ sku: `ZAP-RUN-${size}`, name: `Zapatilla Running Pro T${size}`, family_name: 'Zapatilla Running Pro', brand: 'Marca Sim', size, color: 'Negro', category: 'Calzado', final: 129999, cost: 60000, stock: 6, salon: 2 })),
    ...['S', 'M', 'L', 'XL'].map((size) => ({ sku: `REM-DRY-${size}`, name: `Remera Dry-Fit ${size}`, family_name: 'Remera Dry-Fit', brand: 'Marca Sim', size, color: 'Azul', category: 'Indumentaria', final: 24999, cost: 9000, stock: 10, salon: 4 })),
    ...['41', '42'].map((size) => ({ sku: `BOT-FUT-${size}`, name: `Botines Fútbol T${size}`, family_name: 'Botines Fútbol', brand: 'Marca Sim', size, color: 'Blanco', category: 'Calzado', final: 99999, cost: 45000, stock: 4, salon: 1 })),
    ...['M', 'L'].map((size) => ({ sku: `SHO-RUN-${size}`, name: `Short Running ${size}`, family_name: 'Short Running', brand: 'Marca Sim', size, color: 'Gris', category: 'Indumentaria', final: 19999, cost: 7000, stock: 8, salon: 3 })),
    { sku: 'PEL-FUT-5', name: 'Pelota de Fútbol N°5', category: 'Equipamiento', final: 35999, cost: 15000, stock: 20, salon: 6 },
    { sku: 'MED-X3', name: 'Medias Deportivas x3', category: 'Indumentaria', final: 8999, cost: 3000, stock: 30, salon: 10 },
    { sku: 'MOC-25L', name: 'Mochila Deportiva 25 L', category: 'Accesorios', final: 45999, cost: 20000, stock: 5, salon: 2 },
    { sku: 'BOT-TER-750', name: 'Botella Térmica 750 ml', category: 'Accesorios', final: 15999, cost: 6000, stock: 12, salon: 4 },
    { sku: 'GUA-ARQ', name: 'Guantes de Arquero (última unidad)', category: 'Equipamiento', final: 39999, cost: 18000, stock: 1, salon: 1 },
    { sku: 'RAQ-PAD', name: 'Paleta de Pádel (sin stock)', category: 'Equipamiento', final: 149999, cost: 70000, stock: 0, salon: 0 },
    { sku: 'IVA105-PRUEBA', name: 'Artículo con IVA 10,5 % (prueba)', category: 'Equipamiento', final: 50000, cost: 25000, stock: 5, salon: 2, vat_rate: 10.5 },
];

const CLIENTS = [
    { name: 'Juan Pérez (Consumidor Final)', tax_id: '30111222', tax_condition_id: 'tc_ConsFinal', email: 'juan.perez@simulacion.test', phone: '1155550001' },
    { name: 'Club Atlético Simulado (Responsable Inscripto)', tax_id: cuit('30', '71000001'), tax_condition_id: 'tc_RespInscripto', email: 'compras@clubsimulado.test', address: 'Av. del Deporte 100', credit_limit: 2000000 },
    { name: 'Laura Gómez (Monotributista)', tax_id: cuit('27', '30111223'), tax_condition_id: 'tc_Monotributo', email: 'laura.gomez@simulacion.test' },
    { name: 'Fundación Deporte Simulado (Exento)', tax_id: cuit('30', '71000002'), tax_condition_id: 'tc_Exento', email: 'fundacion@simulacion.test' },
    { name: 'Gimnasio Sin Condición (para cargarla en el momento)', tax_id: cuit('30', '71000003'), email: 'gimnasio@simulacion.test', credit_limit: 500000 },
    { name: 'Escuela de Fútbol (cuenta corriente)', tax_id: cuit('30', '71000004'), tax_condition_id: 'tc_RespInscripto', email: 'escuela@simulacion.test', credit_limit: 1500000 },
];

const SUPPLIERS = [
    { name: 'Distribuidora Deportiva Sim SA', tax_id: cuit('30', '71000010'), email: 'ventas@distribuidora.test', contact_name: 'Marcos Ruiz', phone: '1155550100' },
    { name: 'Textil Sim SRL', tax_id: cuit('30', '71000011'), email: 'pedidos@textil.test', contact_name: 'Ana Torres', phone: '1155550101' },
];

const USERS = [
    { name: 'Gerente Simulación', email: 'gerente@simulacion.test', role: 'manager' },
    { name: 'Cajero Simulación', email: 'cajero@simulacion.test', role: 'cashier' },
    { name: 'Depósito Simulación', email: 'deposito@simulacion.test', role: 'warehouse' },
];

async function main() {
    // Solo sobre la base de simulación, y solo si está vacía de productos.
    const db = await mysql.createConnection(DB);
    const [[{ products }]] = await db.query('SELECT COUNT(*) AS products FROM products');
    if (Number(products) > 0 && !process.argv.includes('--force')) {
        await db.end();
        throw new Error(`La base ${DB_NAME} ya tiene ${products} productos: usá scripts/simulacion.ps1 -Reiniciar para empezar de cero.`);
    }

    await call('POST', '/api/login', ADMIN);
    console.log(`Preparando la simulación en ${DB_NAME} (${API})`);

    await call('PUT', '/api/settings/company', {
        identity: { brand_name: 'WSM Deportes (simulación)', legal_name: 'WSM Deportes Simulación SA', tax_id: cuit('30', '71999999') },
        contact: { phone: '1155550000', email: 'contacto@simulacion.test', website: 'https://simulacion.test' },
        address: { street: 'Av. Siempre Viva 742', city: 'Ciudad de Simulación' },
        operation: { tax_rate: 21, default_currency: 'ARS' },
        billing: { iibb: '901-000000-1', start_date: '2026-01-01', iva_condition: 'Responsable Inscripto', pos: 1, afip_env: 'homologacion' },
    });
    console.log('  empresa: Responsable Inscripto, punto de venta 1, ARCA en homologación (sin credenciales)');

    for (const user of USERS) await call('POST', '/api/users', { ...user, password: SIM_PASSWORD });
    console.log(`  usuarios: ${USERS.map((u) => u.email).join(', ')}`);

    await call('POST', '/api/inventory/locations', { code: DEPOSITO, name: 'Depósito A1' });
    await call('POST', '/api/inventory/locations', { code: SALON, name: 'Salón de ventas', is_sales_floor: true });
    console.log(`  ubicaciones: ${DEPOSITO} (depósito), ${SALON} (salón de ventas)`);

    let barcode = 7790000000001;
    const created = [];
    for (const item of CATALOG) {
        const vatRate = item.vat_rate ?? 21;
        const product = await call('POST', '/api/products', {
            sku: item.sku, barcode: String(barcode++), name: item.name, category: item.category,
            family_name: item.family_name, brand: item.brand, size: item.size, color: item.color,
            sale_price: net(item.final, vatRate), purchase_price: item.cost, vat_rate: vatRate,
            location: DEPOSITO, stock_initial: item.stock,
        });
        created.push({ ...item, id: product.id });
        if (item.salon > 0) {
            await call('POST', '/api/inventory/transfer', { product_id: product.id, from_location: DEPOSITO, to_location: SALON, quantity: item.salon });
        }
    }
    console.log(`  productos: ${created.length} (con stock inicial valuado al costo y parte en el salón)`);

    for (const client of CLIENTS) await call('POST', '/api/clients', client);
    console.log(`  clientes: ${CLIENTS.length} (una por condición de IVA, uno sin condición y uno de cuenta corriente)`);

    const suppliers = [];
    for (const supplier of SUPPLIERS) suppliers.push(await call('POST', '/api/suppliers', supplier));
    console.log(`  proveedores: ${SUPPLIERS.length}`);

    // Una orden de compra ya enviada, lista para simular la recepción con control de calidad.
    const bySku = Object.fromEntries(created.map((p) => [p.sku, p]));
    const po = await call('POST', '/api/purchase-orders', {
        supplier_id: suppliers[0].id,
        order_date: new Date().toISOString().slice(0, 10),
        items: [
            { product_id: bySku['PEL-FUT-5'].id, quantity_ordered: 10, unit_cost: 15000 },
            { product_id: bySku['MED-X3'].id, quantity_ordered: 20, unit_cost: 3000 },
            { product_id: bySku['RAQ-PAD'].id, quantity_ordered: 3, unit_cost: 70000 },
        ],
    });
    await call('PUT', `/api/purchase-orders/${po.id}/status`, { status: 'sent' });
    console.log('  orden de compra enviada a Distribuidora Deportiva Sim SA (pelotas, medias y paletas de pádel)');

    const [[{ entries }]] = await db.query('SELECT COUNT(*) AS entries FROM journal_entries');
    await db.end();
    console.log(`\nListo: ${entries} asientos de stock inicial. Contraseña de todos los usuarios de la simulación: ver docs/execution/GUIA_SIMULACION.md`);
}

main().catch((error) => {
    console.error(`\nNo se pudo preparar la simulación: ${error.message}`);
    process.exit(1);
});
