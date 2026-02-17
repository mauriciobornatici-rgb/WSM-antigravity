// Safety check - Verify existing endpoints still work
const BASE_URL = 'http://localhost:3001';

async function safetyCheck() {
    console.log('🔍 SAFETY CHECK - Verificando funcionalidad existente\n');

    const tests = [];

    try {
        // 1. Products endpoint
        console.log('1. Testing Products API...');
        const productsRes = await fetch(`${BASE_URL}/api/products`);
        tests.push({ name: 'GET /api/products', status: productsRes.ok ? '✅' : '❌', code: productsRes.status });

        // 2. Clients endpoint
        console.log('2. Testing Clients API...');
        const clientsRes = await fetch(`${BASE_URL}/api/clients`);
        tests.push({ name: 'GET /api/clients', status: clientsRes.ok ? '✅' : '❌', code: clientsRes.status });

        // 3. Suppliers endpoint
        console.log('3. Testing Suppliers API...');
        const suppliersRes = await fetch(`${BASE_URL}/api/suppliers`);
        tests.push({ name: 'GET /api/suppliers', status: suppliersRes.ok ? '✅' : '❌', code: suppliersRes.status });

        // 4. Inventory movements (Phase 1)
        console.log('4. Testing Inventory Movements API (Phase 1)...');
        const movementsRes = await fetch(`${BASE_URL}/api/inventory-movements?limit=5`);
        tests.push({ name: 'GET /api/inventory-movements', status: movementsRes.ok ? '✅' : '❌', code: movementsRes.status });

        // 5. Batches
        console.log('5. Testing Batches API...');
        const batchesRes = await fetch(`${BASE_URL}/api/batches`);
        tests.push({ name: 'GET /api/batches', status: batchesRes.ok ? '✅' : '❌', code: batchesRes.status });

        // 6. Serials
        console.log('6. Testing Serial Numbers API...');
        const serialsRes = await fetch(`${BASE_URL}/api/serials`);
        tests.push({ name: 'GET /api/serials', status: serialsRes.ok ? '✅' : '❌', code: serialsRes.status });

        // 7. Company Settings
        console.log('7. Testing Company Settings API...');
        const settingsRes = await fetch(`${BASE_URL}/api/company-settings`);
        tests.push({ name: 'GET /api/company-settings', status: settingsRes.ok ? '✅' : '❌', code: settingsRes.status });

        console.log('\n📊 SAFETY CHECK RESULTS:\n');
        console.log('Endpoint                          Status  Code');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        tests.forEach(test => {
            console.log(`${test.name.padEnd(32)} ${test.status}     ${test.code}`);
        });

        const allPassed = tests.every(t => t.status === '✅');

        if (allPassed) {
            console.log('\n✅ ALL CHECKS PASSED - Safe to proceed!');
            console.log('   Existing functionality is intact.\n');
            return true;
        } else {
            console.log('\n❌ SOME CHECKS FAILED - Investigation needed!');
            const failed = tests.filter(t => t.status === '❌');
            console.log('\nFailed endpoints:');
            failed.forEach(f => console.log(`   - ${f.name} (${f.code})`));
            return false;
        }

    } catch (error) {
        console.error('\n❌ SAFETY CHECK FAILED:', error.message);
        return false;
    }
}

safetyCheck().then(passed => {
    if (passed) {
        console.log('🚀 Ready for Phase 2 implementation!\n');
    } else {
        console.log('⚠️  Fix existing issues before proceeding.\n');
    }
});
