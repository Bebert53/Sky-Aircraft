// Importe les modules nécessaires pour l'interaction avec le système de fichiers, les chemins et la base de données SQLite.
const fs=require('fs'); // Module pour les opérations sur les fichiers.
const path=require('path'); // Module pour la gestion des chemins de fichiers.
const sqlite3=require('sqlite3').verbose(); // Module SQLite3 en mode verbeux pour les messages.

// Définit les chemins du fichier CSV d'entrée et de la base de données SQLite.
const csvPath = path.join(__dirname,'..','data','static','aircraftDatabase.csv'); // Chemin vers le CSV des données d'aéronefs.
const dbPath = path.join(__dirname,'..','data','traffic.db'); // Chemin vers le fichier de la base de données.

// Vérifie si le fichier CSV existe. Si non, affiche une erreur et quitte le processus.
if(!fs.existsSync(csvPath)){ console.error('Fichier CSV introuvable', csvPath); process.exit(1); }

// Lit le contenu du fichier CSV, supprime les espaces en début/fin et divise en lignes.
const txt = fs.readFileSync(csvPath,'utf8'); // Lit le contenu du CSV.
const lines = txt.trim().split(/\r?\n/).filter(Boolean); // Divise en lignes, gère les retours chariot et filtre les lignes vides.

// Vérifie si le fichier CSV est vide après traitement.
if(lines.length<1){ console.error('Fichier CSV vide'); process.exit(1); }

// Extrait les en-têtes de colonne de la première ligne du CSV.
const headers = lines[0].split(',').map(h=>h.replace(/^"|"$/g,'').trim());

// Traite les lignes de données (toutes sauf l'en-tête) pour les convertir en objets JavaScript.
const rows = lines.slice(1).map(l=>{
  const vals=[]; // Tableau pour stocker les valeurs de chaque colonne.
  let cur=''; // Chaîne temporaire pour construire la valeur d'une colonne.
  let inQ=false; // Indicateur si le parser est à l'intérieur de guillemets (pour gérer les virgules dans les champs).

  // Boucle à travers chaque caractère de la ligne pour le parsing CSV.
  for(let i=0;i<l.length;i++){
    const ch=l[i]; // Caractère actuel.
    if(ch==='"'){ // Si le caractère est un guillemet.
      if(inQ && l[i+1]==='"'){ // Si nous sommes déjà entre guillemets et le prochain est aussi un guillemet (guillemet échappé).
        cur+='"'; // Ajoute un guillemet simple à la valeur.
        i++; // Saute le deuxième guillemet.
      } else inQ=!inQ; // Sinon, bascule l'état "entre guillemets".
    } else if(ch===',' && !inQ){ // Si le caractère est une virgule et n'est pas entre guillemets (séparateur de champ).
      vals.push(cur); // Ajoute la valeur actuelle au tableau.
      cur=''; // Réinitialise la chaîne de valeur.
    } else cur+=ch; // Ajoute le caractère à la chaîne de valeur actuelle.
  }
  vals.push(cur); // Ajoute la dernière valeur après la boucle.

  const obj={}; // Objet pour stocker les données de la ligne avec les en-têtes comme clés.
  headers.forEach((h,idx)=>obj[h]=(vals[idx]||'').trim().replace(/^"|"$/g,'')); // Mappe les valeurs aux en-têtes.
  return obj; // Retourne l'objet représentant la ligne.
});

// Ouvre la base de données SQLite.
const db=new sqlite3.Database(dbPath);

// Exécute les commandes SQL séquentiellement.
db.serialize(()=>{
  // Supprime toutes les entrées existantes de la table 'aircraft_types'.
  db.run('DELETE FROM aircraft_types');
  // Prépare une instruction d'insertion ou de remplacement pour la table 'aircraft_types'.
  // Elle insère ou met à jour les champs 'type' et 'count'.
  const stmt = db.prepare('INSERT OR REPLACE INTO aircraft_types(type,count) VALUES(?,?)');
  let inserted=0; // Compteur des enregistrements insérés.

  // Parcourt les objets de lignes parsées et les insère dans la base de données.
  for(const r of rows){
    // Tente de trouver une étiquette ('type', 'aircraft', 'name', etc.) et une valeur numérique ('count', 'value', etc.).
    const label = r.type || r.aircraft || r.name || r.category || r.label || '';
    const count = Number(r.count || r.count_total || r.value || r.total || r.v || 0) || 0;
    
    // Si une étiquette valide est trouvée, exécute l'insertion.
    if(label){ stmt.run(label,count); inserted++; }
  }

  // Finalise l'instruction préparée et exécute un callback une fois toutes les insertions terminées.
  stmt.finalize(()=>{
    // Sélectionne les 20 premiers types d'aéronefs par ordre décroissant de 'count' pour un échantillon.
    db.all('SELECT type,count FROM aircraft_types ORDER BY count DESC LIMIT 20', (e,rows)=>{
      if(e){ console.error('Erreur de requête', e.message); process.exit(1); } // Gère les erreurs de requête.
      // Écrit les résultats de l'importation (nombre d'éléments insérés et l'échantillon) dans un fichier JSON.
      fs.writeFileSync(path.join(__dirname,'aircraft_import_result.json'), JSON.stringify({ inserted, sample: rows }, null, 2));
      console.log('Terminé. Enregistrements insérés=', inserted); // Affiche le nombre total d'enregistrements insérés.
      db.close(); // Ferme la connexion à la base de données.
    });
  });
});
