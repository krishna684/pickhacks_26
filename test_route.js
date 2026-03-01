fetch('http://localhost:3000/api/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: "Millennium Park Chicago", to: "Willis Tower Chicago" })
}).then(r => r.text()).then(console.log).catch(console.error);
