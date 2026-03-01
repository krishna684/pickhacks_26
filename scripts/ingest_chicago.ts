import Database from 'better-sqlite3';
import fetch from 'node-fetch';

const db = new Database('civicsafe.db');

// Enable integer for booleans
db.pragma('journal_mode = WAL');

// Bounding box for Chicago Loop roughly
const BBOX = "41.875,-87.640,41.890,-87.620";

async function initDB() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS route_nodes (
      id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lon REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_edges (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      geometry TEXT NOT NULL,
      distance REAL NOT NULL,
      lighting_quality REAL NOT NULL,
      crash_risk REAL NOT NULL,
      bike_infra INTEGER NOT NULL,
      sidewalk_presence INTEGER NOT NULL,
      complaint_density REAL DEFAULT 0,
      safety_score REAL NOT NULL,
      FOREIGN KEY (source) REFERENCES route_nodes(id),
      FOREIGN KEY (target) REFERENCES route_nodes(id)
    );
  `);

    // Clear any old data
    db.exec('DELETE FROM route_edges');
    db.exec('DELETE FROM route_nodes');
}

// Haversine formula
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; // metres
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
        Math.cos(p1) * Math.cos(p2) *
        Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function fetchOSMData() {
    console.log("Fetching OSM street segments for Chicago Loop...");
    const query = `
    [out:json][timeout:25];
    (
      way["highway"]["highway"!="footway"]["highway"!="pedestrian"](${BBOX});
    );
    out body;
    >;
    out skel qt;
  `;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query
    });

    if (!res.ok) throw new Error("OSM Fetch failed");
    return await res.json();
}

async function fetchCrashData() {
    console.log("Fetching real crash data from City of Chicago...");
    // Chicago Traffic Crashes - roughly the same BBOX
    // https://data.cityofchicago.org/resource/85ca-t3if.json
    const url = `https://data.cityofchicago.org/resource/85ca-t3if.json?$where=within_box(location, 41.890, -87.640, 41.875, -87.620)&$limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Crash data fetch failed");
    return await res.json();
}

async function run() {
    try {
        await initDB();

        const osmData: any = await fetchOSMData();
        const crashData: any = await fetchCrashData();

        console.log(`Received ${osmData.elements.length} OSM elements and ${crashData.length} crash records.`);

        // 1. Process Nodes
        const nodes = new Map();
        osmData.elements.forEach((el: any) => {
            if (el.type === 'node') {
                nodes.set(el.id, { lat: el.lat, lon: el.lon });
            }
        });

        const insertNode = db.prepare('INSERT OR IGNORE INTO route_nodes (id, lat, lon) VALUES (?, ?, ?)');
        db.transaction(() => {
            for (const [id, n] of nodes.entries()) {
                insertNode.run(id.toString(), n.lat, n.lon);
            }
        })();

        // 2. Process Edges (Ways)
        // Map crashes to approximate bounding areas to assign crash risk
        const crashesByBBox = crashData.map((c: any) => ({ lat: parseFloat(c.latitude), lon: parseFloat(c.longitude) })).filter((c: any) => !isNaN(c.lat));

        let maxCrashCount = 1;

        const edgesData: any[] = [];

        osmData.elements.forEach((el: any) => {
            if (el.type === 'way' && el.nodes && el.nodes.length > 1) {
                const tags = el.tags || {};

                // Simple feature parsing
                const hasBike = (tags.cycleway || tags.highway === 'cycleway') ? 1 : 0;
                const hasSidewalk = (tags.sidewalk && tags.sidewalk !== 'none' && tags.sidewalk !== 'no') ? 1 : 0;

                // Split way into segment pairs
                for (let i = 0; i < el.nodes.length - 1; i++) {
                    const n1Id = el.nodes[i];
                    const n2Id = el.nodes[i + 1];
                    const n1 = nodes.get(n1Id);
                    const n2 = nodes.get(n2Id);

                    if (!n1 || !n2) continue;

                    const dist = getDistance(n1.lat, n1.lon, n2.lat, n2.lon);

                    // Count crashes near this segment
                    const midLat = (n1.lat + n2.lat) / 2;
                    const midLon = (n1.lon + n2.lon) / 2;

                    let crashCount = 0;
                    crashesByBBox.forEach((c: any) => {
                        if (getDistance(midLat, midLon, c.lat, c.lon) < 50) {
                            crashCount++;
                        }
                    });

                    maxCrashCount = Math.max(maxCrashCount, crashCount);

                    // Simulated lighting based on road type
                    let lighting = 0.5;
                    if (tags.highway === 'primary' || tags.highway === 'secondary') lighting = 0.9;
                    if (tags.highway === 'residential') lighting = 0.3;

                    edgesData.push({
                        id: `way_${el.id}_${i}`,
                        source: n1Id.toString(),
                        target: n2Id.toString(),
                        geometry: JSON.stringify([[n1.lat, n1.lon], [n2.lat, n2.lon]]),
                        dist,
                        lighting,
                        crashCount,
                        hasBike,
                        hasSidewalk
                    });
                }
            }
        });

        // 3. Normalize Risks and Calculate Final Safety Score
        const insertEdge = db.prepare(`
      INSERT INTO route_edges 
      (id, source, target, geometry, distance, lighting_quality, crash_risk, bike_infra, sidewalk_presence, safety_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        db.transaction(() => {
            for (const e of edgesData) {
                const crashRisk = e.crashCount / maxCrashCount; // 0 to 1

                // Weights: Lighting(0.3), Crash(0.4), Bike(0.1), Sidewalk(0.1)
                const rawSafety = (0.3 * e.lighting) +
                    (0.4 * (1 - crashRisk)) +
                    (0.1 * e.hasBike) +
                    (0.1 * e.hasSidewalk);

                // Scale to 100
                const safetyScore = Math.min(100, Math.max(0, Math.round(rawSafety * 100 * 1.1))); // Boost slightly for visual spread

                insertEdge.run(
                    e.id,
                    e.source,
                    e.target,
                    e.geometry,
                    e.dist,
                    e.lighting,
                    crashRisk,
                    e.hasBike,
                    e.hasSidewalk,
                    safetyScore
                );

                // Insert reverse direction since OSM ways are mostly bidrectional for pedestrians
                insertEdge.run(
                    e.id + "_rev",
                    e.target,
                    e.source,
                    JSON.stringify(JSON.parse(e.geometry).reverse()),
                    e.dist,
                    e.lighting,
                    crashRisk,
                    e.hasBike,
                    e.hasSidewalk,
                    safetyScore
                );
            }
        })();

        console.log(`Ingested ${edgesData.length * 2} directed edges successfully!`);

    } catch (e) {
        console.error("Ingestion failed: ", e);
    }
}

run();
