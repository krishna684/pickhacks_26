const Database = require('better-sqlite3');
const db = new Database('civicsafe.db');

const startLat = 41.88258; // Millennium
const startLon = -87.6225;
const endLat = 41.878876; // Willis Tower
const endLon = -87.635915;

const n1 = db.prepare(`SELECT id, lat, lon, ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?)) as dist_sq FROM route_nodes ORDER BY dist_sq ASC LIMIT 1`).get(startLat, startLat, startLon, startLon);
const n2 = db.prepare(`SELECT id, lat, lon, ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?)) as dist_sq FROM route_nodes ORDER BY dist_sq ASC LIMIT 1`).get(endLat, endLat, endLon, endLon);

console.log("Start Node:", n1);
console.log("End Node:", n2);

const startEdges = db.prepare("SELECT count(*) as c FROM route_edges WHERE source = ?").get(n1.id);
const endEdges = db.prepare("SELECT count(*) as c FROM route_edges WHERE source = ?").get(n2.id);

console.log("Start Node Edges:", startEdges.c);
console.log("End Node Edges:", endEdges.c);
