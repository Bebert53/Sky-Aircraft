#!/usr/bin/env node
// Importe les modules nécessaires
const fs = require('fs'); // Module pour interagir avec le système de fichiers
const path = require('path'); // Module pour manipuler les chemins de fichiers
const sqlite3 = require('sqlite3').verbose(); // Module pour la base de données SQLite (mode verbeux pour les messages d'erreur)

// Définit les chemins des fichiers CSV d'entrée et de la base de données SQLite de sortie.
const csvPath = path.join(__dirname, '..', 'data', 'static', 'aircraftDatabase.csv');
const dbPath = path.join(__dirname, '..', 'data', 'traffic.db');

// Affiche les informations de démarrage de l'importation.
console.log('=== IMPORTATION DES DONNÉES D\'AÉRONEFS ===');
console.log('Fichier CSV source:', csvPath);
console.log('Base de données cible:', dbPath);

// Vérifie si le fichier CSV existe. Si non, affiche une erreur et quitte.
if (!fs.existsSync(csvPath)) {
  console.error('Fichier CSV introuvable à', csvPath);
  process.exit(1);
}

// Récupère les statistiques du fichier CSV et affiche sa taille.
const stat = fs.statSync(csvPath);
console.log('Taille du CSV:', Math.round(stat.size / 1024 / 1024) + 'MB\n');

// Ouvre une connexion à la base de données SQLite.
// Si une erreur survient, l'affiche et quitte le processus.
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Impossible d\'ouvrir la base de données:', err.message);
    process.exit(1);
  }

  // S'assure que les opérations sur la base de données s'exécutent séquentiellement.
  db.serialize(() => {
    // 1. Suppression de l'ancienne table 'aircraft_types' si elle existe.
    db.run('DROP TABLE IF EXISTS aircraft_types', (err) => {
      if (err) console.error('Erreur lors de la suppression de l\'ancienne table:', err.message);
      else console.log('Ancienne table supprimée (si existante)');
    });

    // 2. Création de la nouvelle table 'aircraft_types' avec un schéma défini.
    // Cette table stockera les informations détaillées sur chaque type d'aéronef.
    db.run(`
      CREATE TABLE aircraft_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        icao24 TEXT UNIQUE,
        registration TEXT,
        manufacturer TEXT,
        model TEXT,
        typecode TEXT,
        category TEXT,
        operator TEXT
      )
    `, (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table:', err.message);
        process.exit(1);
      }
      console.log('Nouvelle table "aircraft_types" créée\n');
    });

    // 3. Lecture et importation du fichier CSV.
    console.log('Lecture du fichier CSV...');
    // Lit l'intégralité du fichier CSV en mémoire.
    const text = fs.readFileSync(csvPath, 'utf8');
    // Divise le contenu en lignes et supprime les lignes vides.
    const lines = text.trim().split('\n');
    console.log(`Nombre total de lignes dans le CSV: ${lines.length}`);

    // Vérifie si le CSV contient des données (au moins une ligne d'en-tête et une ligne de données).
    if (lines.length < 2) {
      console.error('Le fichier CSV est vide ou ne contient que l\'en-tête');
      process.exit(1);
    }

    // Analyse la ligne d'en-tête pour extraire les noms des colonnes.
    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.replace(/^"|"$/g, '').trim());
    console.log(`${headers.length} en-têtes trouvés`);
    console.log('Les 10 premiers en-têtes:', headers.slice(0, 10));

    // Prépare l'instruction d'insertion SQL.
    // 'INSERT OR IGNORE' permet d'éviter les erreurs si un 'icao24' est déjà présent (UNIQUE).
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO aircraft_types 
      (icao24, registration, manufacturer, model, typecode, category, operator) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0; // Compteur pour les enregistrements insérés
    let skipped = 0; // Compteur pour les enregistrements ignorés (lignes vides, pas d'icao24)
    let errors = 0; // Compteur pour les erreurs d'insertion

    console.log('\nInsertion des enregistrements...');
    const startTime = Date.now(); // Démarre le chronomètre pour mesurer le temps d'importation.

    // Parcourt chaque ligne du CSV, en commençant après l'en-tête.
    for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx].trim();
      // Ignore les lignes vides.
      if (!line) {
        skipped++;
        continue;
      }

      try {
        // Analyse simple de la ligne CSV pour extraire les valeurs.
        // Gère les champs entourés de guillemets et les guillemets échappés ("").
        const vals = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            // Gère les guillemets échappés (double guillemet à l'intérieur d'un champ).
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++; // Passe le deuxième guillemet
            } else {
              inQuotes = !inQuotes; // Bascule l'état "entre guillemets"
            }
          } else if (ch === ',' && !inQuotes) {
            // Si c'est une virgule et pas entre guillemets, c'est un séparateur de champ.
            vals.push(cur);
            cur = '';
          } else {
            cur += ch; // Ajoute le caractère au champ actuel.
          }
        }
        vals.push(cur); // Ajoute le dernier champ.

        // Mappe les valeurs extraites aux en-têtes de colonne.
        const obj = {};
        headers.forEach((h, idx) => {
          // Supprime les guillemets début/fin et espace les valeurs.
          obj[h] = (vals[idx] || '').trim().replace(/^"|"$/g, '');
        });

        // Extrait les champs spécifiques nécessaires pour l'insertion.
        // Utilise des noms de colonnes alternatifs pour une meilleure robustesse.
        const icao24 = obj.icao24 || obj.ICAO24 || '';
        const registration = obj.registration || obj.Registration || '';
        const manufacturer = obj.manufacturername || obj.ManufacturerName || '';
        const model = obj.model || obj.Model || '';
        const typecode = obj.typecode || obj.TypeCode || '';
        const category = obj.categoryDescription || obj.CategoryDescription || '';
        const operator = obj.operator || obj.Operator || '';

        // N'insère que si un code ICAO24 valide est trouvé.
        if (icao24) {
          stmt.run(icao24, registration, manufacturer, model, typecode, category, operator, (err) => {
            if (err) {
              errors++;
              // Affiche les 5 premières erreurs d'insertion pour éviter un log trop verbeux.
              if (errors <= 5) console.error(`  Erreur ligne ${lineIdx}: ${err.message}`);
            } else {
              inserted++;
            }
          });
        } else {
          skipped++; // Incrémente le compteur des lignes ignorées si pas d'ICAO24.
        }

        // Affiche la progression toutes les 10000 lignes.
        if (lineIdx % 10000 === 0) {
          console.log(`  ✓ Traité ${lineIdx}/${lines.length} lignes...`);
        }
      } catch (e) {
        errors++;
        // Affiche les 5 premières erreurs de parsing.
        if (errors <= 5) console.error(`  Erreur d'analyse sur la ligne ${lineIdx}: ${e.message}`);
      }
    }

    // Finalise l'instruction préparée après toutes les insertions.
    stmt.finalize((err) => {
      if (err) {
        console.error('Erreur lors de la finalisation de l\'insertion:', err.message);
        process.exit(1);
      }

      // Calcule et affiche le temps écoulé pour l'importation.
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\nInsertion finalisée en ${elapsed}s`);
      console.log(`Statistiques: Inséré=${inserted}, Ignoré=${skipped}, Erreurs=${errors}`);

      // 4. Vérification des données importées.
      console.log('\nVérification des données...');
      // Compte le nombre total d'enregistrements dans la table pour vérifier l'importation.
      db.get('SELECT COUNT(*) as cnt FROM aircraft_types', (err, row) => {
        if (err) {
          console.error('Erreur lors du comptage de vérification:', err.message);
          process.exit(1);
        }
        const count = (row && row.cnt) ? row.cnt : 0;
        console.log(`Nombre total d'enregistrements dans la base de données: ${count}`);

        // Affiche un échantillon des 10 premiers enregistrements pour vérification visuelle.
        db.all('SELECT icao24, registration, manufacturer, model FROM aircraft_types LIMIT 10', (err, rows) => {
          if (err) {
            console.error('Erreur lors de la requête d\'échantillon:', err.message);
            process.exit(1);
          }
          console.log('\nExemples d\'enregistrements:');
          console.table(rows); // Utilise console.table pour une meilleure lisibilité.
          db.close(); // Ferme la connexion à la base de données.
          console.log('\nIMPORTATION TERMINÉE AVEC SUCCÈS');
          process.exit(0); // Quitte le processus avec un code de succès.
        });
      });
    });
  });
});
