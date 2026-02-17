import fetch from 'node-fetch';

async function testApi() {
    const url = 'http://localhost:3001/api/invoices';
    const payload = {
        client_id: 'default-consumer-id',
        invoice_type: 'B',
        point_of_sale: 1,
        items: [{
            product_id: '1',
            description: 'Test API Item',
            quantity: 2,
            unit_price: 50,
            vat_rate: 21
        }],
        created_by: 'system'
    };

    try {
        console.log("Calling API...");
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log("Response:", data);
        if (data.id) console.log("SUCCESS! Invoice created with ID:", data.id);
        else console.log("FAILED to create invoice.");
    } catch (e) {
        console.error("Fetch error:", e.message);
    }
}

testApi();
