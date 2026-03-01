const Database = require('better-sqlite3');
const db = new Database('civicsafe.db');

const allEdges = db.prepare("SELECT source, target FROM route_edges").all();
const adj = {};
for (const e of allEdges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
}

function getComponentSize(startId) {
    const visited = new Set();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
        const cur = queue.shift();
        if (adj[cur]) {
            for (const nxt of adj[cur]) {
                if (!visited.has(nxt)) {
                    visited.add(nxt);
                    queue.push(nxt);
                }
            }
        }
    }
    return visited.size;
}

const n1Id = '7142960993'; // Start Node
const n2Id = '10945326847'; // End Node

console.log("Start Node Component Size:", getComponentSize(n1Id));
console.log("End Node Component Size:", getComponentSize(n2Id));
console.log("Total unique sources:", Object.keys(adj).length);
