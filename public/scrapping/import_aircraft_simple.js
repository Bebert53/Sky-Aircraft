#!/usr/bin/env node
// Importe les modules nécessaires
const fs = require('fs'); // Module pour interagir avec le système de fichiers
const path = require('path'); // Module pour manipuler les chemins de fichiers
const sqlite3 = require('sqlite3').verbose(); // Module pour la base de données SQLite (mode verbeux pour les messages d'erreur)

// Définit les chemins du fichier CSV d'entrée et de la base de données SQLite de sortie.
const csvPath = path.join(__dirname, '..', 'data', 'static', 'aircraftDatabase.csv'); // Chemin vers le CSV des données d'aéronefs.
const dbPath = path.join(__dirname, '..', 'data', 'traffic.db'); // Chemin vers le fichier de la base de données.

// Affiche un message de démarrage et les chemins des fichiers.
console.log('Démarrage de l\'importation...');
console.log('Fichier CSV source:', csvPath);
console.log('Base de données cible:', dbPath);

// Vérifie si le fichier CSV existe. Si non, affiche une erreur et quitte.
if (!fs.existsSync(csvPath)) {
  console.error('ERREUR: Fichier CSV introuvable à', csvPath);
  process.exit(1);
}

// Récupère les statistiques du fichier CSV et affiche sa taille.
const stat = fs.statSync(csvPath);
console.log('Taille du fichier CSV:', Math.round(stat.size / 1024 / 1024), 'MB');

// Ouvre une connexion à la base de données SQLite.
// Si une erreur survient, l'affiche et quitte le processus.
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('ERREUR: Impossible d\'ouvrir la base de données', err.message);
    process.exit(1);
  }
  console.log('Base de données ouverte');
  
  // Lit le contenu du fichier CSV.
  const txt = fs.readFileSync(csvPath, 'utf8');
  // Divise le contenu en lignes, supprime les lignes vides.
  const lines = txt.trim().split('\n').filter(l => l.trim());
  console.log('Nombre de lignes dans le CSV:', lines.length);
  
  // Vérifie si le CSV contient suffisamment de données.
  if (lines.length < 2) {
    console.error('ERREUR: Le fichier CSV est vide ou ne contient que l\'en-tête');
    process.exit(1);
  }

  // Analyse la ligne d'en-tête pour extraire les noms des colonnes.
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.replace(/^"|"$/g, '').trim());
  console.log('En-têtes:', headers);

  // S'assure que les opérations sur la base de données s'exécutent séquentiellement.
  db.serialize(() => {
    // Vide la table 'aircraft_types' avant l'insertion de nouvelles données.
    db.run('DELETE FROM aircraft_types', (err) => {
      if (err) {
        console.error('ERREUR lors de la suppression du contenu de la table:', err.message);
        process.exit(1);
      }
      console.log('Table "aircraft_types" vidée');

      // Prépare une instruction SQL pour insérer ou remplacer des données dans la table 'aircraft_types'.
      // Les colonnes 'type' et 'count' sont utilisées.
      const stmt = db.prepare('INSERT OR REPLACE INTO aircraft_types(type, count) VALUES(?, ?)');
      let inserted = 0; // Compteur pour les enregistrements insérés.
      let errors = 0; // Compteur pour les erreurs d'insertion.

      // Parcourt chaque ligne de données du CSV (sauf l'en-tête).
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Ignore les lignes vides.

        try {
          // Analyse de la ligne CSV: extraction des valeurs, gestion des guillemets et des virgules.
          const vals = [];
          let cur = '';
          let inQuotes = false;
          for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            if (ch === '"') {
              if (inQuotes && line[j + 1] === '"') { // Cas d'un guillemet échappé
                cur += '"';
                j++;
              } else {
                inQuotes = !inQuotes; // Bascule l'état 'entre guillemets'
              }
            } else if (ch === ',' && !inQuotes) { // Séparateur de colonne hors guillemets
              vals.push(cur);
              cur = '';
            } else {
              cur += ch; // Ajoute le caractère à la valeur actuelle
            }
          }
          vals.push(cur); // Ajoute la dernière valeur.

          // Mappe les valeurs extraites aux en-têtes de colonne.
          const obj = {};
          headers.forEach((h, idx) => {
            obj[h] = (vals[idx] || '').trim().replace(/^"|"$/g, '');
          });

          // Extrait les champs 'label' (type d'avion) et 'count' (nombre) avec des fallback.
          const label = obj.type || obj.aircraft || obj.name || obj.category || obj.label || '';
          const count = Number(obj.count || obj.count_total || obj.value || obj.total || obj.v || 0) || 0;

          // Insère l'enregistrement si un 'label' valide est trouvé.
          if (label) {
            stmt.run(label, count, (err) => {
              if (err) {
                errors++;
                if (errors < 5) console.error(`Erreur ligne ${i}:`, err.message); // Affiche les 5 premières erreurs
              }
            });
            inserted++; // Incrémente le compteur d'insertion indépendamment de l'erreur (car stmt.run est asynchrone)
          }
        } catch (e) {
          errors++;
          if (errors < 5) console.error(`Erreur d'analyse sur la ligne ${i}:`, e.message); // Affiche les 5 premières erreurs de parsing
        }
      }

      // Finalise l'instruction préparée après toutes les insertions.
      stmt.finalize((err) => {
        if (err) console.error('Erreur de finalisation:', err.message);
        console.log('Enregistrements insérés:', inserted, 'Erreurs:', errors);

        // --- Vérification ---
        console.log('Vérification des données...');
        // Compte le nombre total d'enregistrements dans la table.
        db.get('SELECT COUNT(*) as cnt FROM aircraft_types', (err, row) => {
          if (err) {
            console.error('ERREUR de vérification:', err.message);
            process.exit(1);
          }
          console.log('Nombre final d\'enregistrements dans la base de données:', row.cnt);
          
          // Affiche les 10 premiers types d'aéronefs avec les comptes les plus élevés.
          db.all('SELECT type, count FROM aircraft_types ORDER BY count DESC LIMIT 10', (err, rows) => {
            if (err) {
              console.error('ERREUR de requête:', err.message);
              process.exit(1);
            }
            console.log('Top 10:');
            console.log(JSON.stringify(rows, null, 2)); // Affiche au format JSON lisible.
            db.close(); // Ferme la connexion à la base de données.
            console.log('TERMINÉ'); // Indique la fin du script.
          });
        });
      });
  });
});
