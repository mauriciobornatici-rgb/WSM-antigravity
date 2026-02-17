// Seed sample products
const products = [
    { sku: 'PROD-001', name: 'Mouse Inalámbrico Logitech', description: 'Mouse ergonómico con conexión wireless', category: 'Periféricos', purchase_price: 150000, sale_price: 250000, image_url: '' },
    { sku: 'PROD-002', name: 'Teclado Mecánico RGB', description: 'Teclado gaming con iluminación RGB', category: 'Periféricos', purchase_price: 350000, sale_price: 550000, image_url: '' },
    { sku: 'PROD-003', name: 'Monitor LED 24"', description: 'Monitor Full HD 24 pulgadas', category: 'Monitores', purchase_price: 800000, sale_price: 1200000, image_url: '' },
    { sku: 'PROD-004', name: 'Webcam HD 1080p', description: 'Cámara web con micrófono integrado', category: 'Periféricos', purchase_price: 180000, sale_price: 300000, image_url: '' },
    { sku: 'PROD-005', name: 'Auriculares Gaming', description: 'Auriculares con sonido envolvente 7.1', category: 'Audio', purchase_price: 220000, sale_price: 380000, image_url: '' },
];

const API_URL = 'http://localhost:3001';

async function seedProducts() {
    console.log('Seeding products...');
    for (const product of products) {
        try {
            const response = await fetch(`${API_URL}/api/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(product)
            });
            const result = await response.json();
            console.log('Created:', result.name);
        } catch (error) {
            console.error('Error creating product:', product.name, error);
        }
    }
    console.log('Seeding complete!');
}

seedProducts();
