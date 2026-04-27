 /* ===================================================================================
 * Script d'importation des données de retard
 * -----------------------------------------------------------------------------------
 * Ce script lit les données de performance (ponctualité, retards) des compagnies
 * aériennes et des aéroports depuis des fichiers CSV, nettoie ces données et
 * les insère dans une base de données SQLite.
 *
 * Il est conçu pour être exécuté manuellement via Node.js.
 *
 * Tâches principales :
 * 1. Se connecter à la base de données SQLite.
 * 2. Créer (ou recréer) les tables `airline_delays` et `airport_delays`.
 * 3. Lire et parser `airlines_delays_datas.csv`.
 * 4. Lire et parser `airports_delays_datas.csv`.
 * 5. Insérer les données nettoyées dans les tables correspondantes.
 * 6. Fermer la connexion à la base de données.
 * ===================================================================================
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');

// --- CONFIGURATION ---
const DB_PATH = path.join(__dirname, 'public', 'data', 'traffic.db');
const AIRLINES_DELAYS_CSV = path.join(__dirname, 'public', 'data', 'static', 'airlines_delays_datas.csv');
const AIRPORTS_DELAYS_CSV = path.join(__dirname, 'public', 'data', 'static', 'airports_delays_datas.csv');

// --- CONNEXION À LA BASE DE DONNÉES ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erreur de connexion à la base de données:', err.message);
        process.exit(1);
    }
    console.log('Connecté à la base de données SQLite.');
});

/**
 * Crée les tables de la base de données pour les retards.
 * Les tables existantes sont supprimées avant d'être recréées pour garantir
 * un jeu de données frais à chaque exécution.
 * @returns {Promise<void>}
 */
function createTables() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Supprime et recrée la table pour les retards des compagnies.
            db.run('DROP TABLE IF EXISTS airline_delays');
            db.run(`
                CREATE TABLE airline_delays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    region TEXT, rank INTEGER, airline_name TEXT, iata_code TEXT,
                    on_time_arrival REAL, tracked_flights REAL, completion_factor REAL, total_flights INTEGER
                )
            `, (err) => {
                if (err) return reject(err);
                console.log('Table "airline_delays" recréée.');
            });

            // Supprime et recrée la table pour les retards des aéroports.
            db.run('DROP TABLE IF EXISTS airport_delays');
            db.run(`
                CREATE TABLE airport_delays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    region TEXT, rank INTEGER, airport_name TEXT, iata_code TEXT, category TEXT,
                    on_time_departure REAL, tracked_flights REAL, total_flights INTEGER, avg_dep_delay_min REAL
                )
            `, (err) => {
                if (err) return reject(err);
                console.log('Table "airport_delays" recréée.');
                resolve();
            });
        });
    });
}

// --- FONCTIONS UTILITAIRES DE NETTOYAGE ---

/**
 * Nettoie une chaîne de caractères en supprimant les guillemets et les espaces superflus.
 * @param {string} str La chaîne à nettoyer.
 * @returns {string} La chaîne nettoyée.
 */
function cleanString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/["']/g, '').trim();
}

/**
 * Nettoie et convertit une chaîne en nombre à virgule flottante (float).
 * Gère les pourcentages (%) et les erreurs de parsing.
 * @param {string} str La chaîne à convertir.
 * @returns {number|null} Le nombre converti ou null si invalide.
 */
function cleanAndParseFloat(str) {
    if (typeof str !== 'string') return null;
    const cleaned = str.replace(/[%]/g, '').trim();
    const value = parseFloat(cleaned);
    return isNaN(value) ? null : value;
}

/**
 * Nettoie et convertit une chaîne en nombre entier (integer).
 * Gère les séparateurs de milliers (,) et les erreurs de parsing.
 * @param {string} str La chaîne à convertir.
 * @returns {number|null} Le nombre converti ou null si invalide.
 */
function cleanAndParseInt(str) {
    if (typeof str !== 'string') return null;
    const cleaned = str.replace(/[,]/g, '').trim();
    const value = parseInt(cleaned, 10);
    return isNaN(value) ? null : value;
}

/**
 * Lit le fichier CSV des compagnies aériennes, le parse et insère les données dans la DB.
 * @returns {Promise<void>}
 */
function importAirlinesData() {
    return new Promise((resolve, reject) => {
        console.log(`[Compagnies] Lecture de ${path.basename(AIRLINES_DELAYS_CSV)}...`);
        
        if (!fs.existsSync(AIRLINES_DELAYS_CSV)) {
             return reject(new Error(`Fichier non trouvé: ${AIRLINES_DELAYS_CSV}`));
        }

        const rows = [];
        const airlineHeaders = ['Index', 'Region', 'Rank', 'Airline Name', 'IATA Code', 'On-Time Arrival', 'Tracked Flights', 'Completion Factor', 'Total Flights'];
        
        fs.createReadStream(AIRLINES_DELAYS_CSV)
            .pipe(csv({ separator: ',', skipLines: 1, headers: airlineHeaders, skipEmptyLines: true }))
            .on('data', (row) => {
                // Mappe les colonnes du CSV aux champs de la base de données en les nettoyant.
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
                console.log(`[Compagnies] Fin de lecture. ${rows.length} lignes trouvées.`);
                if (rows.length === 0) return resolve();

                // Prépare une requête d'insertion pour plus d'efficacité.
                const stmt = db.prepare(`INSERT INTO airline_delays (region, rank, airline_name, iata_code, on_time_arrival, tracked_flights, completion_factor, total_flights) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

                // Utilise une transaction pour insérer toutes les lignes d'un coup (beaucoup plus rapide).
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    rows.forEach(row => stmt.run(Object.values(row)));
                    db.run("COMMIT", (err) => {
                        if (err) return reject(err);
                        stmt.finalize();
                        console.log(`[Compagnies] ${rows.length} lignes insérées dans la table "airline_delays".`);
                        resolve();
                    });
                });
            })
            .on('error', (err) => reject(err));
    });
}

/**
 * Lit le fichier CSV des aéroports, le parse et insère les données dans la DB.
 * @returns {Promise<void>}
 */
function importAirportsData() {
    return new Promise((resolve, reject) => {
        console.log(`[Aéroports] Lecture de ${path.basename(AIRPORTS_DELAYS_CSV)}...`);
        
        if (!fs.existsSync(AIRPORTS_DELAYS_CSV)) {
             return reject(new Error(`Fichier non trouvé: ${AIRPORTS_DELAYS_CSV}`));
        }

        const rows = [];
        const airportHeaders = ['Index', 'Region', 'Rank', 'Airport Name', 'IATA Code', 'Category', 'On-Time Departure', 'Tracked Flights', 'Total Flights', 'Avg Dep Delay (min)'];
        
        fs.createReadStream(AIRPORTS_DELAYS_CSV)
            .pipe(csv({ separator: ';', skipLines: 1, headers: airportHeaders, skipEmptyLines: true }))
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
                console.log(`[Aéroports] Fin de lecture. ${rows.length} lignes trouvées.`);
                if (rows.length === 0) return resolve();

                const stmt = db.prepare(`INSERT INTO airport_delays (region, rank, airport_name, iata_code, category, on_time_departure, tracked_flights, total_flights, avg_dep_delay_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)

                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    rows.forEach(row => stmt.run(Object.values(row)));
                    db.run("COMMIT", (err) => {
                        if (err) return reject(err);
                        stmt.finalize();
                        console.log(`[Aéroports] ${rows.length} lignes insérées dans la table "airport_delays".`);
                        resolve();
                    });
                });
            })
            .on('error', (err) => reject(err));
    });
}

/**
 * Fonction principale qui orchestre le processus d'importation.
 */
async function main() {
    try {
        await createTables();
        await importAirlinesData();
        await importAirportsData();
    } catch (err) {
        console.error('Une erreur est survenue durant le processus d\'importation:', err);
    } finally {
        db.close((err) => {
            if (err) console.error('Erreur lors de la fermeture de la base de données:', err.message);
            else console.log('Connexion à la base de données fermée.');
        });
    }
}

// Exécute la fonction principale.
main();
