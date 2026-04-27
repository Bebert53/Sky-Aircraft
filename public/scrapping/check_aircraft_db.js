// Importe le module sqlite3 pour interagir avec la base de données SQLite.
const sqlite3 = require('sqlite3').verbose();
// Importe le module path pour manipuler les chemins de fichiers.
const path = require('path');

// Construit le chemin complet vers le fichier de base de données 'traffic.db'.
// '__dirname' est le répertoire du script actuel ('scrapping').
// '..' remonte d'un niveau pour atteindre le répertoire 'public'.
// 'data' est le sous-répertoire contenant la base de données.
const dbPath = path.join(__dirname, '..', 'data', 'traffic.db');

// Ouvre une connexion à la base de données en mode lecture seule.
// Si une erreur survient lors de l'ouverture, elle est affichée et le processus se termine.
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Erreur à l\'ouverture de la base de données', err.message);
    process.exit(1); // Quitte le processus avec un code d'erreur.
  }
  
  // Exécute une requête SQL pour compter le nombre total d'entrées dans la table 'aircraft_types'.
  db.get('SELECT COUNT(1) as cnt FROM aircraft_types', (e, row) => {
    if (e) { 
      console.error('Erreur lors du comptage des types d\'aéronefs', e.message); 
      process.exit(1); // Quitte le processus avec un code d'erreur en cas d'échec de la requête.
    }
    // Affiche le nombre total d'aéronefs trouvés.
    console.log('Nombre total de types d\'aéronefs:', row.cnt);
    
    // Exécute une seconde requête SQL pour récupérer les 10 types d'aéronefs les plus fréquents.
    // Les résultats sont triés par 'count' (nombre d'occurrences) par ordre décroissant.
    db.all('SELECT type, count FROM aircraft_types ORDER BY count DESC LIMIT 10', (er, rows) => {
      if (er) { 
        console.error('Erreur lors de la récupération des types d\'aéronefs les plus fréquents', er.message); 
        process.exit(1); // Quitte le processus avec un code d'erreur.
      }
      // Affiche les 10 types d'aéronefs les plus fréquents au format JSON lisible.
      console.log('Top 10 des types d\'aéronefs:\n', JSON.stringify(rows, null, 2));
      // Ferme la connexion à la base de données une fois toutes les opérations terminées.
      db.close();
    });
  });
});
