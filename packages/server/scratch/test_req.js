import http from 'http';

http.get('http://localhost:3001/api/supplier-invoices', (res) => {
    console.log('STATUS:', res.statusCode);
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('BODY:', data);
    });
}).on('error', (err) => {
    console.error('ERROR:', err.message);
});
