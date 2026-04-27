/**
 * ===================================================================================
 * Script d'importation et d'agrégation des fabricants d'aéronefs
 * -----------------------------------------------------------------------------------
 * Ce script finalise le traitement des données sur les fabricants d'aéronefs.
 * Il prend en entrée le fichier CSV prétraité (`aircraft_with_assigned_types.csv`),
 * qui contient le fabricant détecté pour chaque aéronef.
 *
 * Tâches principales :
 * 1. Lire le fichier CSV.
 * 2. Compter le nombre d'aéronefs pour chaque fabricant (agrégation).
 * 3. Se connecter à la base de données SQLite.
 * 4. Créer (ou recréer) la table `aircraft_manufacturer_counts`.
 * 5. Insérer les comptes agrégés dans cette table.
 *
 * Le résultat est une table simple qui peut être utilisée efficacement par l'API
 * pour alimenter les graphiques du tableau de bord.
 * ===================================================================================
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');

// --- CONFIGURATION ---
const DB_PATH = path.join(__dirname, 'public', 'data', 'traffic.db');
const PROCESSED_AIRCRAFT_CSV = path.join(__dirname, 'public', 'data', 'static', 'aircraft_with_assigned_types.csv');

// --- CONNEXION À LA BASE DE DONNÉES ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erreur de connexion à la base de données:', err.message);
        process.exit(1);
    }
    console.log('Connecté à la base de données SQLite.');
});

/**
 * Crée la table `aircraft_manufacturer_counts`.
 * La table existante est supprimée pour garantir un import à jour.
 * @returns {Promise<void>}
 */
function createTable() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('DROP TABLE IF EXISTS aircraft_manufacturer_counts', (err) => {
                if (err) return reject(err);
                console.log('-> Table "aircraft_manufacturer_counts" supprimée.');
            });
            db.run(`
                CREATE TABLE aircraft_manufacturer_counts (
                    manufacturer_name TEXT PRIMARY KEY,
                    aircraft_count INTEGER NOT NULL
                )
            `, (err) => {
                if (err) return reject(err);
                console.log('Table "aircraft_manufacturer_counts" créée.');
                resolve();
            });
        });
    });
}

/**
 * Lit le fichier CSV, agrège les données et les insère dans la base de données.
 * @returns {Promise<void>}
 */
function importData() {
    return new Promise((resolve, reject) => {
        console.log(`[Agrégation] Lecture de ${path.basename(PROCESSED_AIRCRAFT_CSV)}...`);
        
        if (!fs.existsSync(PROCESSED_AIRCRAFT_CSV)) {
             return reject(new Error(`Fichier d'entrée non trouvé: ${PROCESSED_AIRCRAFT_CSV}`));
        }

        // Utilise une Map pour compter efficacement les occurrences de chaque fabricant.
        const manufacturerCounts = new Map();

        fs.createReadStream(PROCESSED_AIRCRAFT_CSV)
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim().replace(/^\ufeff/, '') // Nettoie les en-têtes
            }))
            .on('data', (row) => {
                // Pour chaque ligne, on récupère le fabricant détecté.
                const manufacturer = row['Detected_Type'];
                // On ignore les fabricants "Unknown".
                if (manufacturer && manufacturer !== 'Unknown') {
                    manufacturerCounts.set(manufacturer, (manufacturerCounts.get(manufacturer) || 0) + 1);
                }
            })
            .on('end', () => {
                console.log(`[Agrégation] Fin de lecture. ${manufacturerCounts.size} fabricants comptabilisés.`);
                if (manufacturerCounts.size === 0) {
                    console.log("[Agrégation] Aucune donnée à importer.");
                    return resolve();
                }

                // Prépare la requête d'insertion.
                const stmt = db.prepare(`
                    INSERT INTO aircraft_manufacturer_counts (manufacturer_name, aircraft_count)
                    VALUES (?, ?)
                `);

                // Insère toutes les données dans une transaction pour de meilleures performances.
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    for (const [name, count] of manufacturerCounts) {
                        stmt.run(name, count);
                    }
                    db.run("COMMIT", (err) => {
                        if (err) return reject(err);
                        stmt.finalize();
                        console.log(`[Agrégation] ${manufacturerCounts.size} totaux par fabricant ont été insérés.`);
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
        await createTable();
        await importData();
    } catch (err) {
        console.error('Une erreur est survenue durant le processus d\'importation:', err);
    } finally {
        db.close((err) => {
            if (err) console.error('Erreur lors de la fermeture de la base de données:', err.message);
            else console.log('Connexion à la base de données fermée.');
        });
    }
}

// Exécute le script.
main();