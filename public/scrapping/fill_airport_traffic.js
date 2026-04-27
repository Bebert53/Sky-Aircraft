#!/usr/bin/env node
// Importe les modules nécessaires
const fs = require('fs'); // Module pour interagir avec le système de fichiers
const path = require('path'); // Module pour manipuler les chemins de fichiers
const sqlite3 = require('sqlite3').verbose(); // Module pour la base de données SQLite (mode verbeux pour les messages d'erreur)

// Définit les chemins des fichiers CSV d'entrée et de la base de données SQLite de sortie.
const csvPath = path.join(__dirname, '..', 'data', 'static', 'estat_ttr00012_en.csv');
const dbPath = path.join(__dirname, '..', 'data', 'traffic.db');

// Affiche les informations de démarrage de l'importation.
console.log('=== IMPORTATION DES DONNÉES DE TRAFIC AÉRIEN (Eurostat) ===');
console.log('Fichier CSV source:', csvPath);
console.log('Base de données cible:', dbPath);

// Vérifie si le fichier CSV existe. Si non, affiche une erreur et quitte.
if (!fs.existsSync(csvPath)) {
  console.error('Fichier CSV introuvable à', csvPath);
  process.exit(1);
}

// Récupère les statistiques du fichier CSV et affiche sa taille.
const stat = fs.statSync(csvPath);
console.log('Taille du CSV:', Math.round(stat.size / 1024) + 'KB\n');

// Ouvre une connexion à la base de données SQLite.
// Si une erreur survient, l'affiche et quitte le processus.
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Impossible d\'ouvrir la base de données:', err.message);
    process.exit(1);
  }

  // S'assure que les opérations sur la base de données s'exécutent séquentiellement.
  db.serialize(() => {
    // 1. Suppression de l'ancienne table 'airport_traffic' si elle existe.
    db.run('DROP TABLE IF EXISTS airport_traffic', (err) => {
      if (err) console.error('⚠️ Erreur lors de la suppression de l\'ancienne table:', err.message);
      else console.log('Ancienne table "airport_traffic" supprimée (si existante)');
    });

    // 2. Création de la nouvelle table 'airport_traffic' avec un schéma défini.
    // Cette table stockera le nombre de passagers par pays et par année.
    db.run(`
      CREATE TABLE airport_traffic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_code TEXT,
        year INTEGER,
        passenger_count INTEGER,
        UNIQUE(country_code, year)
      )
    `, (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table:', err.message);
        process.exit(1);
      }
      console.log('Nouvelle table "airport_traffic" créée\n');
    });

    // 3. Lecture et importation du fichier CSV.
    console.log('📖 Lecture du fichier CSV...');
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
    const headers = headerLine.split(',').map(h => h.trim());
    console.log(`📋 En-têtes trouvés: ${headers.join(', ')}\n`);

    // Trouve les indices des colonnes requises ('geo', 'TIME_PERIOD', 'OBS_VALUE').
    const geoIdx = headers.indexOf('geo');
    const timeIdx = headers.indexOf('TIME_PERIOD');
    const valueIdx = headers.indexOf('OBS_VALUE');

    // Vérifie si toutes les colonnes requises ont été trouvées.
    if (geoIdx === -1 || timeIdx === -1 || valueIdx === -1) {
      console.error('Colonnes requises introuvables.');
      console.error('Recherche: geo, TIME_PERIOD, OBS_VALUE');
      console.error('Trouvées:', headers);
      process.exit(1);
    }

    // Prépare l'instruction d'insertion SQL.
    // 'INSERT OR IGNORE' permet d'éviter les erreurs si une paire (country_code, year) est déjà présente (UNIQUE).
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO airport_traffic 
      (country_code, year, passenger_count) 
      VALUES (?, ?, ?)
    `);

    let inserted = 0; // Compteur pour les enregistrements insérés
    let skipped = 0; // Compteur pour les enregistrements ignorés (lignes vides, données invalides)
    let errors = 0; // Compteur pour les erreurs d'insertion

    console.log('Insertion des enregistrements...');
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
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            vals.push(cur);
            cur = '';
          } else {
            cur += ch;
          }
        }
        vals.push(cur); // Ajoute le dernier champ.

        // Extrait les champs spécifiques en utilisant les indices trouvés précédemment.
        const countryCode = (vals[geoIdx] || '').trim().replace(/^"|"$/g, '');
        const year = Number((vals[timeIdx] || '').trim().replace(/^"|"$/g, ''));
        const passengerCount = Number((vals[valueIdx] || '').trim().replace(/^"|"$/g, ''));

        // N'insère que si toutes les données sont valides.
        if (countryCode && isFinite(year) && isFinite(passengerCount)) {
          stmt.run(countryCode, year, passengerCount, (err) => {
            if (err) {
              errors++;
              // Affiche les 5 premières erreurs d'insertion pour éviter un log trop verbeux.
              if (errors <= 5) console.error(`  Erreur ligne ${lineIdx}: ${err.message}`);
            } else {
              inserted++;
            }
          });
        } else {
          skipped++; // Incrémente le compteur des lignes ignorées si données invalides.
        }

        // Affiche la progression toutes les 50 lignes.
        if (lineIdx % 50 === 0) {
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
      db.get('SELECT COUNT(*) as cnt FROM airport_traffic', (err, row) => {
        if (err) {
          console.error('Erreur lors du comptage de vérification:', err.message);
          process.exit(1);
        }
        const count = (row && row.cnt) ? row.cnt : 0;
        console.log(`Nombre total d'enregistrements dans la base de données: ${count}`);

        // Affiche un échantillon des 10 premiers enregistrements pour vérification visuelle, triés par année décroissante.
        db.all('SELECT country_code, year, passenger_count FROM airport_traffic ORDER BY year DESC LIMIT 10', (err, rows) => {
          if (err) {
            console.error('Erreur lors de la requête d\'échantillon:', err.message);
            process.exit(1);
          }
          console.log('\nExemples d\'enregistrements (années les plus récentes):');
          console.table(rows); // Utilise console.table pour une meilleure lisibilité.
          db.close(); // Ferme la connexion à la base de données.
          console.log('\nIMPORTATION TERMINÉE AVEC SUCCÈS');
          process.exit(0); // Quitte le processus avec un code de succès.
        });
      });
    });
  });
});
