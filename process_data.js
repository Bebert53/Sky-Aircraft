const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');
const { Readable } = require('stream');

// --- CONFIGURATION ---
const DB_PATH = path.join(__dirname, 'public', 'data', 'traffic.db');
const AIRLINES_DELAYS_CSV = path.join(__dirname, 'public', 'data', 'static', 'airlines_delays_datas.csv');
const AIRPORTS_DELAYS_CSV = path.join(__dirname, 'public', 'data', 'static', 'airports_delays_datas.csv');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('DB connection error:', err);
        process.exit(1);
    }
    console.log('Connected to the SQLite database.');
});

function createTables() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('DROP TABLE IF EXISTS airline_delays');
            db.run(`
                CREATE TABLE IF NOT EXISTS airline_delays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    region TEXT,
                    rank INTEGER,
                    airline_name TEXT,
                    iata_code TEXT,
                    on_time_arrival REAL,
                    tracked_flights REAL,
                    completion_factor REAL,
                    total_flights INTEGER
                )
            `, (err) => {
                if (err) return reject(err);
                console.log('Table "airline_delays" created.');
            });

            db.run('DROP TABLE IF EXISTS airport_delays');
            db.run(`
                CREATE TABLE IF NOT EXISTS airport_delays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    region TEXT,
                    rank INTEGER,
                    airport_name TEXT,
                    iata_code TEXT,
                    category TEXT,
                    on_time_departure REAL,
                    tracked_flights REAL,
                    total_flights INTEGER,
                    avg_dep_delay_min REAL
                )
            `, (err) => {
                if (err) return reject(err);
                console.log('Table "airport_delays" created.');
                resolve();
            });
        });
    });
}

function cleanString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/["']/g, '').trim();
}

function cleanAndParseFloat(str) {
    if (typeof str !== 'string') return null;
    const cleaned = str.replace(/[%]/g, '').trim();
    const value = parseFloat(cleaned);
    return isNaN(value) ? null : value;
}

function cleanAndParseInt(str) {
    if (typeof str !== 'string') return null;
    const cleaned = str.replace(/[,]/g, '').trim();
    const value = parseInt(cleaned, 10);
    return isNaN(value) ? null : value;
}

// Fonction magique pour réparer les lignes mal formattées (double CSV)
function preprocessContent(fileContent) {
    const lines = fileContent.split(/\r?\n/);
    const cleanedLines = lines.map(line => {
        const trimmed = line.trim();
        // Si la ligne commence et finit par des guillemets (et n'est pas vide)
        // Exemple: "Asia Pacific,1,...,""9,740"""
        if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
            // On retire les guillemets extérieurs : Asia Pacific,1,...,""9,740""
            let content = trimmed.slice(1, -1);
            // On remplace les doubles guillemets par des simples : Asia Pacific,1,...,"9,740"
            content = content.replace(/""/g, '"');
            return content;
        }
        return trimmed;
    });
    // On retire les lignes vides
    return cleanedLines.filter(line => line.length > 0).join('\n');
}

function importAirlinesData() {
    return new Promise((resolve, reject) => {
        console.log(`[Airlines] Reading ${AIRLINES_DELAYS_CSV}...`);
        
        if (!fs.existsSync(AIRLINES_DELAYS_CSV)) {
             return reject(new Error(`File not found: ${AIRLINES_DELAYS_CSV}`));
        }

        const rawContent = fs.readFileSync(AIRLINES_DELAYS_CSV, 'utf8');
        const cleanContent = preprocessContent(rawContent);
        const rows = [];

        Readable.from(cleanContent)
            .pipe(csv({ 
                skipEmptyLines: true,
                mapHeaders: ({ header }) => header.trim().replace(/^\ufeff/, '') 
            }))
            .on('data', (row) => {
                const newRow = {
                    region: cleanString(row['Region']),
                    rank: cleanAndParseInt(row['Rank']),
                    airline_name: cleanString(row['Airline Name']),
                    iata_code: cleanString(row['IATA Code']),
                    on_time_arrival: cleanAndParseFloat(row['On-Time Arrival']),
                    tracked_flights: cleanAndParseFloat(row['Tracked Flights']),
                    completion_factor: cleanAndParseFloat(row['Completion Factor']),
                    total_flights: cleanAndParseInt(row['Total Flights'])
                };
                rows.push(newRow);
            })
            .on('end', () => {
                console.log(`[Airlines] Finished parsing. Found ${rows.length} rows.`);
                if (rows.length === 0) return resolve();

                const stmt = db.prepare(`
                    INSERT INTO airline_delays (region, rank, airline_name, iata_code, on_time_arrival, tracked_flights, completion_factor, total_flights)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                db.serialize(() => {
                    db.run('DELETE FROM airline_delays', (err) => {
                        if (err) return reject(err);
                        
                        db.run("BEGIN TRANSACTION");
                        rows.forEach(row => {
                            stmt.run(row.region, row.rank, row.airline_name, row.iata_code, row.on_time_arrival, row.tracked_flights, row.completion_factor, row.total_flights);
                        });
                        db.run("COMMIT", (err) => {
                            if (err) return reject(err);
                            stmt.finalize();
                            console.log(`[Airlines] ${rows.length} rows inserted.`);
                            resolve();
                        });
                    });
                });
            })
            .on('error', (err) => reject(err));
    });
}

function importAirportsData() {
    return new Promise((resolve, reject) => {
        console.log(`[Airports] Reading ${AIRPORTS_DELAYS_CSV}...`);
        
        if (!fs.existsSync(AIRPORTS_DELAYS_CSV)) {
             return reject(new Error(`File not found: ${AIRPORTS_DELAYS_CSV}`));
        }

        const rawContent = fs.readFileSync(AIRPORTS_DELAYS_CSV, 'utf8');
        const cleanContent = preprocessContent(rawContent);
        const rows = [];

        Readable.from(cleanContent)
            .pipe(csv({ 
                skipEmptyLines: true,
                mapHeaders: ({ header }) => header.trim().replace(/^\ufeff/, '')
            }))
            .on('data', (row) => {
                const newRow = {
                    region: cleanString(row['Region']),
                    rank: cleanAndParseInt(row['Rank']),
                    airport_name: cleanString(row['Airport Name']),
                    iata_code: cleanString(row['IATA Code']),
                    category: cleanString(row['Category']),
                    on_time_departure: cleanAndParseFloat(row['On-Time Departure']),
                    tracked_flights: cleanAndParseFloat(row['Tracked Flights']),
                    total_flights: cleanAndParseInt(row['Total Flights']),
                    avg_dep_delay_min: cleanAndParseFloat(row['Avg Dep Delay (min)'])
                };
                rows.push(newRow);
            })
            .on('end', () => {
                console.log(`[Airports] Finished parsing. Found ${rows.length} rows.`);
                if (rows.length === 0) return resolve();

                const stmt = db.prepare(`
                    INSERT INTO airport_delays (region, rank, airport_name, iata_code, category, on_time_departure, tracked_flights, total_flights, avg_dep_delay_min)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                db.serialize(() => {
                    db.run('DELETE FROM airport_delays', (err) => {
                        if (err) return reject(err);

                        db.run("BEGIN TRANSACTION");
                        rows.forEach(row => {
                            stmt.run(row.region, row.rank, row.airport_name, row.iata_code, row.category, row.on_time_departure, row.tracked_flights, row.total_flights, row.avg_dep_delay_min);
                        });
                        db.run("COMMIT", (err) => {
                            if (err) return reject(err);
                            stmt.finalize();
                            console.log(`[Airports] ${rows.length} rows inserted.`);
                            resolve();
                        });
                    });
                });
            })
            .on('error', (err) => reject(err));
    });
}

async function main() {
    try {
        await createTables();
        await importAirlinesData();
        await importAirportsData();
    } catch (err) {
        console.error('An error occurred during the import process:', err);
    } finally {
        db.close((err) => {
            if (err) console.error('Error closing the database:', err.message);
            console.log('Database connection closed.');
        });
    }
}

main();