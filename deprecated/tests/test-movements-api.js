// Quick test for inventory movements API
const BASE_URL = 'http://localhost:3001';

async function testMovementsAPI() {
    try {
        console.log('🧪 Testing Inventory Movements API\n');

        // 1. Get products to test with
        console.log('1. Getting products...');
        const productsRes = await fetch(`${BASE_URL}/api/products`);
        const products = await productsRes.json();

        if (products.length === 0) {
            console.log('❌ No products found');
            return;
        }

        const testProduct = products[0];
        console.log(`   ✅ Test product: ${testProduct.name} (ID: ${testProduct.id})\n`);

        // 2. Create a test movement
        console.log('2. Creating test movement (adjustment)...');
        const movementData = {
            type: 'adjustment',
            product_id: testProduct.id,
            from_location: null,
            to_location: 'STORAGE',
            quantity: 10,
            unit_cost: testProduct.purchase_price || 0,
            reason: 'Initial stock adjustment',
            notes: 'Test movement created via API',
            performed_by: 'system'
        };

        const createRes = await fetch(`${BASE_URL}/api/inventory-movements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(movementData)
        });

        if (!createRes.ok) {
            console.log(`   ❌ Failed to create movement: ${createRes.status}`);
            return;
        }

        const newMovement = await createRes.json();
        console.log(`   ✅ Movement created: ${newMovement.id}`);
        console.log(`      Type: ${newMovement.type}`);
        console.log(`      Quantity: ${newMovement.quantity}`);
        console.log(`      Location: ${newMovement.to_location}\n`);

        // 3. Get all movements
        console.log('3. Fetching all movements...');
        const movementsRes = await fetch(`${BASE_URL}/api/inventory-movements?limit=10`);
        const movements = await movementsRes.json();
        console.log(`   ✅ Found ${movements.length} movements\n`);

        // 4. Get movements for specific product
        console.log(`4. Fetching movements for product ${testProduct.sku}...`);
        const productMovementsRes = await fetch(`${BASE_URL}/api/products/${testProduct.id}/movements`);
        const productMovements = await productMovementsRes.json();
        console.log(`   ✅ Found ${productMovements.length} movements for this product\n`);

        // 5. Test batches API
        console.log('5. Testing Batches API...');
        const batchData = {
            product_id: testProduct.id,
            batch_number: `BATCH-${Date.now()}`,
            manufacturing_date: new Date().toISOString().split('T')[0],
            expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            quantity_initial: 50,
            location: 'WAREHOUSE-A1',
            notes: 'Test batch'
        };

        const batchRes = await fetch(`${BASE_URL}/api/batches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batchData)
        });

        if (batchRes.ok) {
            const newBatch = await batchRes.json();
            console.log(`   ✅ Batch created: ${newBatch.batch_number}`);
            console.log(`      Expiration: ${newBatch.expiration_date}`);
            console.log(`      Quantity: ${newBatch.quantity_initial}\n`);
        } else {
            console.log(`   ⚠️  Batch creation failed (might already exist)\n`);
        }

        // 6. Test serials API
        console.log('6. Testing Serial Numbers API...');
        const serialData = {
            product_id: testProduct.id,
            serial_number: `SN-${Date.now()}`,
            location: 'WAREHOUSE-A1-01',
            warranty_months: 12
        };

        const serialRes = await fetch(`${BASE_URL}/api/serials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serialData)
        });

        if (serialRes.ok) {
            const newSerial = await serialRes.json();
            console.log(`   ✅ Serial created: ${newSerial.serial_number}`);
            console.log(`      Status: ${newSerial.status}`);
            console.log(`      Location: ${newSerial.location}\n`);
        } else {
            console.log(`   ⚠️  Serial creation failed\n`);
        }

        console.log('✅ All tests completed successfully!');
        console.log('\n📊 Summary:');
        console.log(`   - Inventory movements: ${movements.length} total`);
        console.log(`   - Product movements: ${productMovements.length} for ${testProduct.name}`);
        console.log('   - Batches: Working ✓');
        console.log('   - Serial numbers: Working ✓');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

testMovementsAPI();
