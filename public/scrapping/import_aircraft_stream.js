const fs = require('fs'); // Module pour interagir avec le système de fichiers
const path = require('path'); // Module pour manipuler les chemins de fichiers
const readline = require('readline'); // Module pour lire les fichiers ligne par ligne (streaming)
const sqlite3 = require('sqlite3').verbose(); // Module pour la base de données SQLite (mode verbeux pour les messages d'erreur)

// Définit les chemins du fichier CSV d'entrée et de la base de données SQLite de sortie.
const csvPath = path.join(__dirname, '..', 'data', 'static', 'aircraftDatabase.csv'); // Chemin vers le CSV des données d'aéronefs.
const dbPath = path.join(__dirname, '..', 'data', 'traffic.db'); // Chemin vers le fichier de la base de données.

// Vérifie si le fichier CSV existe. Si non, affiche une erreur et quitte.
if (!fs.existsSync(csvPath)) {
  console.error('Fichier CSV introuvable:', csvPath);
  process.exit(1);
}

// Fonction asynchrone auto-exécutante pour gérer l'importation par flux.
(async function(){
  const db = new sqlite3.Database(dbPath); // Ouvre une connexion à la base de données.
  try {
    // Démarre une transaction pour améliorer les performances d'insertion.
    await new Promise((resolve, reject) => db.run('BEGIN TRANSACTION', (e) => e ? reject(e) : resolve()));
    // Supprime toutes les entrées existantes de la table 'aircraft_types'.
    await new Promise((resolve, reject) => db.run('DELETE FROM aircraft_types', (e) => e ? reject(e) : resolve()));
    // Prépare l'instruction d'insertion SQL.
    const stmt = db.prepare('INSERT OR REPLACE INTO aircraft_types(type,count) VALUES(?,?)');

    // Crée un flux de lecture pour le fichier CSV.
    const rs = fs.createReadStream(csvPath, { encoding: 'utf8' });
    // Crée une interface de lecture ligne par ligne à partir du flux.
    const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

    let headers = null; // Stocke les en-têtes de colonne une fois lus.
    let lineNo = 0; // Compteur de lignes.
    let inserted = 0; // Compteur des enregistrements insérés.

    // Parcourt chaque ligne du fichier CSV de manière asynchrone.
    for await (const line of rl) {
      lineNo++;
      const l = line.trim();
      if (!l) continue; // Ignore les lignes vides.

      // Traitement de l'en-tête (première ligne).
      if (!headers) {
        // Analyse l'en-tête: divise par virgules et nettoie les guillemets.
        headers = l.split(',').map(h => h.replace(/^\"|\"$/g, '').trim());
        continue;
      }

      // Analyse de la ligne de données.
      const vals = []; // Tableau pour stocker les valeurs de chaque colonne.
      let cur = ''; // Chaîne temporaire pour construire la valeur d'une colonne.
      let inQ = false; // Indicateur si le parser est à l'intérieur de guillemets.

      // Logique de parsing CSV robuste (gestion des guillemets et des virgules).
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') {
          if (inQ && l[i+1] === '"') { cur += '"'; i++; } // Guillemet échappé (double guillemet)
          else inQ = !inQ; // Bascule l'état 'entre guillemets'.
        } else if (ch === ',' && !inQ) { // Si virgule et non entre guillemets, c'est un séparateur.
          vals.push(cur);
          cur = '';
        } else {
          cur += ch; // Ajoute le caractère à la valeur actuelle.
        }
      }
      vals.push(cur); // Ajoute la dernière valeur.

      // Mappe les valeurs extraites aux en-têtes de colonne.
      const obj = {};
      headers.forEach((h, idx) => obj[h] = (vals[idx] || '').trim().replace(/^\"|\"$/g, ''));
      
      // Extrait les champs 'label' (type d'avion) et 'count' (nombre) avec des fallback.
      const label = obj.type || obj.aircraft || obj.name || obj.category || obj.label || '';
      const count = Number(obj.count || obj.count_total || obj.value || obj.total || obj.v || 0) || 0;
      
      // Insère l'enregistrement si un 'label' valide est trouvé.
      if (label) { stmt.run(label, count); inserted++; }
      
      // Effectue un COMMIT de la transaction périodiquement pour éviter de surcharger la mémoire
      // et pour sauvegarder les progrès en cas de crash.
      if (inserted % 1000 === 0) {
        await new Promise((res, rej) => db.run('COMMIT', (e) => e ? rej(e) : res())); // Valide la transaction actuelle.
        await new Promise((res, rej) => db.run('BEGIN TRANSACTION', (e) => e ? rej(e) : res())); // Démarre une nouvelle transaction.
      }
    }
    stmt.finalize(); // Finalise l'instruction préparée une fois toutes les insertions traitées.
    await new Promise((resolve, reject) => db.run('COMMIT', (e) => e ? reject(e) : resolve())); // Valide la dernière transaction.
    
    // Après l'importation, génère un fichier JSON avec un échantillon des données importées pour vérification.
    db.all('SELECT type,count FROM aircraft_types ORDER BY count DESC LIMIT 20', (err, rows) => {
      if (err) {
        console.error('Erreur lors de la requête finale:', err.message);
        process.exit(1);
      }
      const out = { inserted: inserted, sample: rows }; // Objet de sortie avec le nombre d'éléments insérés et l'échantillon.
      fs.writeFileSync(path.join(__dirname, 'aircraft_import_result.json'), JSON.stringify(out, null, 2), 'utf8'); // Écrit le JSON.
      console.log('Importation terminée, insérés =', inserted); // Affiche le nombre total d'enregistrements insérés.
      db.close(); // Ferme la connexion à la base de données.
    });
  } catch (e) {
    console.error('L\'importation a échoué', e && e.message); // Affiche l'erreur en cas d'échec de l'importation.
    try { db.run('ROLLBACK'); } catch (_) {} // Tente d'annuler la transaction en cas d'erreur.
    db.close(); // Ferme la connexion à la base de données.
    process.exit(1); // Quitte le processus avec un code d'erreur.
  }
})();
