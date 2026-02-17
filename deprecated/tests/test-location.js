// Test script to update a product with location
const BASE_URL = 'http://localhost:3001';

async function testProductLocation() {
    try {
        // 1. Get all products
        console.log('1. Obteniendo productos...');
        const productsRes = await fetch(`${BASE_URL}/api/products`);
        const products = await productsRes.json();
        console.log(`   Encontrados ${products.length} productos`);

        if (products.length === 0) {
            console.log('❌ No hay productos para probar');
            return;
        }

        const firstProduct = products[0];
        console.log(`\n2. Producto seleccionado: ${firstProduct.name} (ID: ${firstProduct.id})`);
        console.log(`   Ubicación actual: ${firstProduct.location || 'Sin asignar'}`);

        // 2. Update product with location
        console.log('\n3. Actualizando producto con ubicación A1-01-01-01...');
        const updateRes = await fetch(`${BASE_URL}/api/products/${firstProduct.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sku: firstProduct.sku,
                name: firstProduct.name,
                description: firstProduct.description || '',
                category: firstProduct.category,
                image_url: firstProduct.image_url || '',
                location: 'A1-01-01-01',  // Nueva ubicación
                purchase_price: firstProduct.purchase_price,
                sale_price: firstProduct.sale_price
            })
        });

        if (!updateRes.ok) {
            const error = await updateRes.json();
            console.log('❌ Error al actualizar:', error);
            return;
        }

        const updated = await updateRes.json();
        console.log('✅ Producto actualizado exitosamente!');
        console.log(`   Nueva ubicación: ${updated.location}`);

        // 3. Verify the update
        console.log('\n4. Verificando actualización...');
        const verifyRes = await fetch(`${BASE_URL}/api/products`);
        const verifyProducts = await verifyRes.json();
        const verifiedProduct = verifyProducts.find(p => p.id === firstProduct.id);

        if (verifiedProduct && verifiedProduct.location === 'A1-01-01-01') {
            console.log('✅ Verificación exitosa! La ubicación se guardó correctamente.');
            console.log('\n📍 Ahora recarga la página de Inventario en tu navegador para ver el cambio');
        } else {
            console.log('❌ La ubicación no se guardó correctamente');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testProductLocation();
