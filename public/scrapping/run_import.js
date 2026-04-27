// Importe les modules nécessaires.
const fs = require('fs'); // Module pour interagir avec le système de fichiers.
const path = require('path'); // Module pour manipuler les chemins de fichiers.
const { spawn } = require('child_process'); // Module pour créer des processus enfants.

// Définit les chemins du script à exécuter et du fichier de log.
const scriptPath = path.join(__dirname, 'import_aircraft_simple.js'); // Chemin vers le script Node.js à lancer.
const logPath = path.join(__dirname, 'import_log.txt'); // Chemin vers le fichier où les logs seront écrits.

// Lance le script 'import_aircraft_simple.js' comme un processus enfant.
// 'node' est la commande, et [scriptPath] est l'argument.
// `detached: false` : le processus enfant sera tué si le parent l'est.
// `stdio: ['ignore', 'pipe', 'pipe']` :
//   - stdin est ignoré.
//   - stdout du processus enfant est redirigé vers un pipe.
//   - stderr du processus enfant est redirigé vers un pipe.
const proc = spawn('node', [scriptPath], {
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe']
});

// Crée un flux d'écriture pour le fichier de log.
// `flags: 'w'` assure que le fichier est créé ou tronqué s'il existe déjà.
const logStream = fs.createWriteStream(logPath, { flags: 'w' });

// Écoute les données provenant de la sortie standard (stdout) du processus enfant.
proc.stdout.on('data', (data) => {
  logStream.write(data); // Écrit les données dans le fichier de log.
  process.stdout.write(data); // Affiche les données dans la console du processus parent.
});

// Écoute les données provenant de la sortie d'erreur standard (stderr) du processus enfant.
proc.stderr.on('data', (data) => {
  logStream.write(data); // Écrit les données d'erreur dans le fichier de log.
  process.stderr.write(data); // Affiche les données d'erreur dans la console du processus parent.
});

// Écoute l'événement de fermeture du processus enfant.
proc.on('close', (code) => {
  console.log(`\nLe processus s'est terminé avec le code ${code}`); // Affiche le code de sortie.
  logStream.end(); // Ferme le flux d'écriture du fichier de log.
});
