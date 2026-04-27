/**
 * ===================================================================================
 * Script de pré-traitement pour l'identification des fabricants d'aéronefs
 * -----------------------------------------------------------------------------------
 * Ce script lit un fichier CSV volumineux (`aircraftDatabase.csv`) contenant des
 * informations brutes sur des aéronefs. Pour chaque ligne, il tente d'identifier
 * le fabricant en utilisant une série de règles et d'heuristiques.
 *
 * Le résultat est un nouveau fichier CSV (`aircraft_with_assigned_types.csv`)
 * qui est une copie de l'original avec une colonne supplémentaire : "Detected_Type".
 *
 * Ce script est une étape de pré-traitement nécessaire avant que les données
 * puissent être agrégées et importées dans la base de données finale.
 *
 * Il génère également un fichier d'échantillons (`unknown_sample.csv`) pour aider
 * à l'analyse des aéronefs dont le fabricant n'a pas pu être identifié.
 * ===================================================================================
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const os = require('os');

// --- CONFIGURATION DES FICHIERS ---
const AIRCRAFT_DB_CSV = path.join(__dirname, 'public', 'data', 'static', 'aircraftDatabase.csv');
const OUTPUT_CSV = path.join(__dirname, 'public', 'data', 'static', 'aircraft_with_assigned_types.csv');
const UNKNOWN_SAMPLE_CSV = path.join(__dirname, 'public', 'data', 'static', 'unknown_sample.csv');


// --- BASE DE CONNAISSANCES DES FABRICANTS ---
// Ce dictionnaire sert de base de règles pour mapper divers noms ou codes
// à un nom de fabricant standardisé.
const manufacturerDb = {
    "CESSNA": "Cessna", "Cessna": "Cessna",
    "PIPER": "Piper", "Piper": "Piper",
    "ROBINSON": "Robinson Company", "Robinson": "Robinson Company", "Robin": "Robinson Company", "ROBIN": "Robinson Company",
    "BOEING": "Boeing", "Boeing": "Boeing",
    "AIRBUS": "Airbus", "Airbus": "Airbus",
    "BEECHCRAFT": "Beechcraft", "Beechcraft": "Beechcraft",
    "CIRRUS": "Cirrus", "Cirrus": "Cirrus",
    "EMBRAER": "Embraer", "Embraer": "Embraer",
    "BOMBARDIER": "Bombardier", "Bombardier": "Bombardier",
    "GULFSTREAM": "Gulfstream", "Gulfstream": "Gulfstream",
    "DASSAULT": "Dassault", "Dassault": "Dassault",
    "CHAMPION": "Champion", "Champion": "Champion",
    "MOONEY": "Mooney", "Mooney": "Mooney",
    "SCHLEICHER": "Alexander Schleicher", "Schleicher": "Alexander Schleicher",
    "CAMERON": "Cameron", "Cameron": "Cameron",
    "RAYTHEON": "Raytheon Aircraft", "Raytheon": "Raytheon Aircraft",
    "ROCKWELL": "Rockwell Collins", "Rockwell": "Rockwell Collins",
    "LEARJET": "Learjet", "Learjet": "Learjet",
    "TEXTRON": "Textron Aviation", "Textron": "Textron Aviation",
    "GROB": "Grob", "Grob": "Grob",
    "DORNIER": "Dornier", "Dornier": "Dornier",
    "DREAM": "Dream Aircraft", "Dream": "Dream Aircraft",
    "VAN'S": "Van's Aircraft", "Van's": "Van's Aircraft",
    "WESTLAND": "Westland Aircraft & Helicopters", "Westland": "Westland Aircraft & Helicopters",
    "LINDSTRAND": "Lindstrand Hot Air Balloons", "LINDSTRAND": "Lindstrand Hot Air Balloons",
    "LUSCOMBE": "Luscombe Airplane Corp", "LUSCOMBE": "Luscombe Airplane Corp",
    "EVEKTOR": "Evektor-Aerotechnik", "Evektor": "Evektor-Aerotechnik"
};

const manufacturerKeys = Object.keys(manufacturerDb);

/**
 * Tente d'identifier le fabricant d'un aéronef à partir des données d'une ligne CSV.
 * La méthode est basée sur une série d'heuristiques :
 * 1. Recherche d'une correspondance directe dans la base de connaissances.
 * 2. Recherche de mots-clés (noms de fabricants) dans les valeurs de la ligne.
 * 3. Détection de motifs connus dans les codes de modèle (ex: "C1" pour Cessna).
 * @param {Object} row - Une ligne de données parsée depuis le fichier CSV.
 * @returns {string} Le nom du fabricant identifié, ou "Unknown".
 */
function identifyManufacturer(row) {
    for (const key in row) {
        const value = row[key];
        if (typeof value === 'string' && value.trim() !== '') {
            const valueUpper = value.trim().toUpperCase();

            // 1. Vérification directe
            if (manufacturerDb[valueUpper]) {
                return manufacturerDb[valueUpper];
            }

            // 2. Recherche par mot-clé
            for (const manuKey of manufacturerKeys) {
                if (valueUpper.includes(manuKey.toUpperCase())) {
                    return manufacturerDb[manuKey];
                }
            }

            // 3. Détection de motifs
            if (valueUpper.startsWith("C1") || valueUpper.startsWith("C2")) return "Cessna";
            if (valueUpper.startsWith("PA")) return "Piper";
            if (valueUpper.startsWith("B7") || valueUpper.startsWith("B74")) return "Boeing";
            if (valueUpper.startsWith("A3") || valueUpper.startsWith("A32")) return "Airbus";
            if (valueUpper.startsWith("R22") || valueUpper.startsWith("R44")) return "Robinson Company";
            if (valueUpper.includes("BEECH") || valueUpper.startsWith("BE")) return "Beechcraft";
            if (valueUpper.startsWith("SR")) return "Cirrus";
            if (valueUpper.startsWith("E1") || valueUpper.startsWith("E7")) return "Embraer";
        }
    }
    return "Unknown";
}

/**
 * Classe utilitaire simple pour compter les occurrences d'une clé.
 */
class Counter extends Map {
    add(key) {
        this.set(key, (this.get(key) || 0) + 1);
    }
}

/**
 * Échappe correctement un champ pour l'écriture dans un fichier CSV.
 * Ajoute des guillemets si le champ contient une virgule, des guillemets, ou un retour à la ligne.
 * @param {string|number} field - Le champ à échapper.
 * @returns {string} Le champ formaté pour le CSV.
 */
function escapeCsvField(field) {
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\r') || str.includes('\n')) {
        // Double les guillemets existants et entoure le tout de guillemets.
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Fonction principale qui orchestre la lecture, le traitement et l'écriture des fichiers.
 */
async function processFile() {
    console.log("Lancement du processus d'identification des fabricants d'aéronefs...");
    console.log(`Fichier d'entrée : ${path.basename(AIRCRAFT_DB_CSV)}`);
    console.log(`Fichier de sortie : ${path.basename(OUTPUT_CSV)}`);

    const writeStream = fs.createWriteStream(OUTPUT_CSV);
    const unknownWriteStream = fs.createWriteStream(UNKNOWN_SAMPLE_CSV);

    let originalHeaders = [];
    let totalCount = 0;
    let unknownCount = 0;
    const typeCounts = new Counter();
    const unknownValues = new Counter();
    
    // Lit uniquement les en-têtes du fichier pour préparer les flux d'écriture.
    // C'est une optimisation pour ne pas lire le fichier deux fois entièrement.
    const headerParser = csv();
    const headerStream = fs.createReadStream(AIRCRAFT_DB_CSV).pipe(headerParser);

    headerStream.on('headers', (headers) => {
        originalHeaders = headers;
        const newHeaders = [...originalHeaders, 'Detected_Type'];
        
        // Écrit les nouvelles en-têtes dans les fichiers de sortie.
        writeStream.write(newHeaders.join(',') + os.EOL);
        unknownWriteStream.write(newHeaders.join(',') + os.EOL);
        
        headerStream.destroy(); // Arrête la lecture après avoir obtenu les en-têtes.
        
        // Lance le traitement principal du fichier.
        startProcessing();
    });

    function startProcessing() {
        const dataStream = fs.createReadStream(AIRCRAFT_DB_CSV);
        const dataParser = csv();

        // Utilise des flux (streams) pour traiter le fichier ligne par ligne
        // sans charger tout le contenu en mémoire, ce qui est efficace pour les gros fichiers.
        dataStream.pipe(dataParser)
        .on('data', (row) => {
            totalCount++;
            const detectedType = identifyManufacturer(row);
            
            row['Detected_Type'] = detectedType;

            typeCounts.add(detectedType);

            // Si le fabricant est inconnu, on collecte des informations pour analyse.
            if (detectedType === 'Unknown') {
                unknownCount++;
                // Écrit un échantillon des lignes non identifiées.
                if (unknownCount <= 50) {
                     const values = originalHeaders.map(h => row[h] || '');
                     values.push(row['Detected_Type']);
                     const csvLine = values.map(escapeCsvField).join(',');
                     unknownWriteStream.write(csvLine + os.EOL);
                }

                // Compte les valeurs les plus communes dans les lignes inconnues
                // pour aider à identifier de nouvelles règles de détection.
                for (const key in row) {
                    if (key !== 'Detected_Type') {
                        const value = row[key];
                        if (typeof value === 'string' && value.trim() !== '') {
                            unknownValues.add(value.trim());
                        }
                    }
                }
            }

            // Écrit la ligne traitée (avec le type détecté) dans le fichier de sortie.
            const allValues = originalHeaders.map(h => row[h] || '');
            allValues.push(row['Detected_Type']);
            const csvLine = allValues.map(escapeCsvField).join(',');
            writeStream.write(csvLine + os.EOL);
        })
        .on('end', () => {
            // Finalise les flux d'écriture et affiche un rapport de traitement.
            writeStream.end();
            unknownWriteStream.end();

            console.log(os.EOL + '='.repeat(60));
            console.log('TRAITEMENT TERMINÉ');
            console.log('='.repeat(60) + os.EOL);
            console.log(`Nombre total d'aéronefs traités: ${totalCount}`);
            
            console.log(os.EOL + 'Distribution par Fabricant (Top 20):');
            const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
            for (let i = 0; i < 20 && i < sortedTypes.length; i++) {
                const [type, count] = sortedTypes[i];
                console.log(`${type.padEnd(30)} -> ${count} aéronefs`);
            }

            console.log(os.EOL + '='.repeat(60));
            console.log(`ANALYSE DES INCONNUS: ${typeCounts.get('Unknown') || 0} aéronefs non identifiés`);
            console.log('='.repeat(60) + os.EOL);

            const sortedUnknowns = [...unknownValues.entries()].sort((a,b) => b[1] - a[1]);
            console.log('Top 30 des valeurs les plus communes dans les lignes non identifiées:');
            for(let i = 0; i < 30 && i < sortedUnknowns.length; i++) {
                const [value, count] = sortedUnknowns[i];
                console.log(`'${value}'`.padEnd(40) + ` -> ${count} occurrences`);
            }
            
            console.log(`${os.EOL}✔ Fichier de sortie généré : ${path.basename(OUTPUT_CSV)}`);
            console.log(`✔ Échantillon d'inconnus généré : ${path.basename(UNKNOWN_SAMPLE_CSV)}`);
        })
        .on('error', (err) => {
            console.error("Une erreur est survenue durant le traitement:", err);
        });
    }
}

// Démarre le processus.
processFile();