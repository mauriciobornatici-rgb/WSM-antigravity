// Simplified test
const BASE_URL = 'http://localhost:3001';

async function quickTest() {
    const res = await fetch(`${BASE_URL}/api/products`);
    const products = await res.json();
    const prod = products[0];

    console.log(`Product: ${prod.name}`);
    console.log(`Current location: ${prod.location || 'NULL'}`);

    const updateRes = await fetch(`${BASE_URL}/api/products/${prod.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...prod,
            location: 'A1-01-01-01'
        })
    });

    const updated = await updateRes.json();
    console.log(`New location: ${updated.location || 'NULL'}`);

    if (updated.location === 'A1-01-01-01') {
        console.log('SUCCESS!');
    } else {
        console.log('FAILED - location is still NULL');
    }
}

quickTest().catch(console.error);
