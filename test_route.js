async function go() {
    const u = (q) => `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    let res = await fetch(u("Times Square New York"), { headers: { "User-Agent": "CivicSafeAI/1.0" } });
    let j1 = await res.json();
    let res2 = await fetch(u("Empire State Building New York"), { headers: { "User-Agent": "CivicSafeAI/1.0" } });
    let j2 = await res2.json();

    if (!j1[0] || !j2[0]) {
        return console.log("Geocode failed");
    }

    const oRoute = `https://router.project-osrm.org/route/v1/foot/${j1[0].lon},${j1[0].lat};${j2[0].lon},${j2[0].lat}?steps=true&geometries=geojson&alternatives=true`;
    console.log(oRoute);
    let r = await fetch(oRoute);
    let rj = await r.json();
    console.log("Found", rj.routes.length, "routes");
    console.log("Route 0 length", rj.routes[0].geometry.coordinates.length);
}
go().catch(console.error);
