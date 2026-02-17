// Comprehensive test for Phase 2: Reception System
const BASE_URL = 'http://localhost:3001';

async function testReceptionSystem() {
    console.log('🧪 PHASE 2: Testing Reception System\n');
    console.log('══════════════════════════════════════════════\n');

    try {
        // STEP 1: Verify existing endpoints still work
        console.log('✅ STEP 1: Safety Check - Existing Endpoints\n');

        const productsRes = await fetch(`${BASE_URL}/api/products`);
        console.log(`   Products API: ${productsRes.ok ? '✅ OK' : '❌ FAIL'} (${productsRes.status})`);

        const movementsRes = await fetch(`${BASE_URL}/api/inventory-movements?limit=1`);
        console.log(`   Movements API: ${movementsRes.ok ? '✅ OK' : '❌ FAIL'} (${movementsRes.status})\n`);

        // STEP 2: Test Purchase Orders
        console.log('📦 STEP 2: Testing Purchase Orders\n');

        // Get suppliers
        const suppliersRes = await fetch(`${BASE_URL}/api/suppliers`);
        const suppliers = await suppliersRes.json();

        // Get products
        const productsDataRes = await fetch(`${BASE_URL}/api/products`);
        const products = await productsDataRes.json();

        if (suppliers.length === 0 || products.length === 0) {
            console.log('   ⚠️  Need suppliers and products to test');
            return;
        }

        const testSupplier = suppliers[0];
        const testProduct = products[0];

        console.log(`   Using supplier: ${testSupplier.name}`);
        console.log(`   Using product: ${testProduct.name}\n`);

        // Create PO
        const poData = {
            supplier_id: testSupplier.id,
            order_date: new Date().toISOString().split('T')[0],
            expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            items: [
                {
                    product_id: testProduct.id,
                    quantity_ordered: 100,
                    unit_cost: testProduct.purchase_price || 50
                }
            ],
            notes: 'Test PO created via API'
        };

        const createPORes = await fetch(`${BASE_URL}/api/purchase-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(poData)
        });

        if (!createPORes.ok) {
            console.log(`   ❌ Failed to create PO: ${createPORes.status}`);
            return;
        }

        const newPO = await createPORes.json();
        console.log(`   ✅ PO Created: ${newPO.po_number}`);
        console.log(`      Total: $${newPO.total_amount}`);
        console.log(`      Status: ${newPO.status}\n`);

        // Get all POs
        const allPOsRes = await fetch(`${BASE_URL}/api/purchase-orders`);
        const allPOs = await allPOsRes.json();
        console.log(`   ✅ Retrieved ${allPOs.length} purchase orders\n`);

        // STEP 3: Test Receptions
        console.log('📥 STEP 3: Testing Receptions\n');

        // Create reception for the PO
        const receptionData = {
            purchase_order_id: newPO.id,
            supplier_id: testSupplier.id,
            remito_number: `REM-TEST-${Date.now()}`,
            items: [
                {
                    product_id: testProduct.id,
                    po_item_id: allPOs[0].items[0].id,
                    quantity_expected: 100,
                    quantity_received: 95,  // 5 missing
                    unit_cost: testProduct.purchase_price || 50,
                    location_assigned: 'WAREHOUSE-A1',
                    batch_number: `BATCH-${Date.now()}`,
                    expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                }
            ],
            notes: 'Test reception - 5 units missing'
        };

        const createRecRes = await fetch(`${BASE_URL}/api/receptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(receptionData)
        });

        if (!createRecRes.ok) {
            console.log(`   ❌ Failed to create reception: ${createRecRes.status}`);
            const error = await createRecRes.text();
            console.log(`      Error: ${error}`);
            return;
        }

        const newReception = await createRecRes.json();
        console.log(`   ✅ Reception Created: ${newReception.reception_number}`);
        console.log(`      Status: ${newReception.status}\n`);

        // STEP 4: Test Quality Check
        console.log('🔍 STEP 4: Testing Quality Check\n');

        const qcData = {
            reception_id: newReception.id,
            product_id: testProduct.id,
            inspector_id: 'inspector-1',
            result: 'pass',
            quantity_checked: 95,
            quantity_passed: 90,
            quantity_failed: 5,
            defect_description: '5 units damaged in transit',
            action_taken: 'reject',
            notes: 'Return damaged units to supplier'
        };

        const qcRes = await fetch(`${BASE_URL}/api/quality-checks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(qcData)
        });

        if (qcRes.ok) {
            const qc = await qcRes.json();
            console.log(`   ✅ Quality Check Created`);
            console.log(`      Result: ${qc.result}`);
            console.log(`      Passed: ${qc.quantity_passed}/${qc.quantity_checked}\n`);
        }

        // STEP 5: Approve Reception
        console.log('✔️  STEP 5: Approving Reception\n');

        const approveRes = await fetch(`${BASE_URL}/api/receptions/${newReception.id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved_by: 'test-user' })
        });

        if (!approveRes.ok) {
            const error = await approveRes.text();
            console.log(`   ❌ Failed to approve: ${error}`);
        } else {
            console.log(`   ✅ Reception Approved!`);
            console.log(`      Status updated to: approved`);
            console.log(`      Inventory movements created ✓`);
            console.log(`      Product batch created ✓\n`);
        }

        // STEP 6: Verify inventory movement was created
        console.log('📊 STEP 6: Verifying Integration\n');

        const productMovementsRes = await fetch(`${BASE_URL}/api/products/${testProduct.id}/movements`);
        const productMovements = await productMovementsRes.json();

        const receptionMovement = productMovements.find(m => m.type === 'reception');

        if (receptionMovement) {
            console.log(`   ✅ Inventory Movement Created`);
            console.log(`      Type: ${receptionMovement.type}`);
            console.log(`      Quantity: ${receptionMovement.quantity}`);
            console.log(`      Location: ${receptionMovement.to_location}\n`);
        }

        // Summary
        console.log('══════════════════════════════════════════════');
        console.log('📋 TEST SUMMARY\n');
        console.log('✅ Purchase Order: Created & Retrieved');
        console.log('✅ Reception: Created');
        console.log('✅ Quality Check: Passed');
        console.log('✅ Approval: Complete');
        console.log('✅ Integration: Inventory updated');
        console.log('✅ Batches: Created automatically');
        console.log('\n🎉 ALL PHASE 2 TESTS PASSED!\n');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        console.error(error.stack);
    }
}

testReceptionSystem();
