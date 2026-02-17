// Test API Client Creation
const testClient = {
    name: "Test Cliente Debug",
    tax_id: "9999999999",
    email: "debug@test.com",
    phone: "0999999999",
    address: "Test Address Debug"
};

fetch('http://localhost:3001/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testClient)
})
    .then(res => {
        console.log('Response Status:', res.status);
        return res.json();
    })
    .then(data => {
        console.log('Response Data:', data);
    })
    .catch(err => {
        console.error('Error:', err);
    });
