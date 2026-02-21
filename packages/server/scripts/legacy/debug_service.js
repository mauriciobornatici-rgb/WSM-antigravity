import inventoryService from './services/inventory.service.js';

async function run() {
    try {
        console.log('Testing InventoryService.findAll...');
        const products = await inventoryService.findAll({}, { limit: 5 });
        console.log('Got', products.length, 'products.');
        if (products.length > 0) {
            console.log('First product:', products[0]);
        } else {
            console.log('Empty result!');
        }
    } catch (e) {
        console.error('Error:', e);
    }
    process.exit(0);
}
run();
