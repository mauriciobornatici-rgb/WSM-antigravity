// Direct test to update product with location
const BASE_URL = 'http://localhost:3001';

async function testDirectUpdate() {
    try {
        // Get first product
        console.log('1. Getting products...');
        const res1 = await fetch(`${BASE_URL}/api/products`);
        const products = await res1.json();

        if (products.length === 0) {
            console.log('No products found');
            return;
        }

        const product = products[0];
        console.log(`\n2. Product: ${product.name}`);
        console.log(`   Current location: ${product.location || 'NULL'}`);

        // Prepare update data - INCLUDING location
        const updateData = {
            sku: product.sku,
            name: product.name,
            description: product.description || '',
            category: product.category,
            image_url: product.image_url || '',
            location: 'A1-01-01-01',  // ← THE LOCATION!
            purchase_price: product.purchase_price,
            sale_price: product.sale_price
        };

        console.log('\n3. Sending update with data:');
        console.log(JSON.stringify(updateData, null, 2));

        // Send PUT request
        const res2 = await fetch(`${BASE_URL}/api/products/${product.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        if (!res2.ok) {
            const error = await res2.text();
            console.log(`\n❌ Error ${res2.status}:`, error);
            return;
        }

        const updated = await res2.json();
        console.log('\n4. Response from server:');
        console.log(JSON.stringify(updated, null, 2));

        console.log('\n5. Verification:');
        console.log(`   Location in response: ${updated.location}`);

        if (updated.location === 'A1-01-01-01') {
            console.log('\n✅ SUCCESS! Location was saved!');
            console.log('   Now refresh the Inventory page to see it');
        } else {
            console.log('\n❌ FAILED! Location was not saved');
            console.log(`   Expected: A1-01-01-01`);
            console.log(`   Got: ${updated.location}`);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
    }
}

testDirectUpdate();
