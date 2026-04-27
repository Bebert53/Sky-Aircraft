/**
 * ===================================================================================
 * Serveur principal de l'application SkyVis.
 * -----------------------------------------------------------------------------------
 * Ce serveur Node.js utilise Express.js et gère plusieurs responsabilités :
 * 
 * 1.  **Serveur Web** : Sert les fichiers statiques de l'interface utilisateur (HTML, CSS, JS).
 * 2.  **API de Données** : Expose plusieurs points d'API RESTful (/api/...) qui permettent
 *     au frontend de récupérer des données depuis la base de données SQLite.
 * 3.  **Collecteur de Données OpenSky** : Interroge périodiquement l'API OpenSky Network
 *     pour obtenir les positions des avions en temps réel via un processus de "polling".
 * 4.  **Authentification OAuth2** : Gère l'obtention et le renouvellement des tokens d'accès
 *     pour l'API OpenSky.
 * 5.  **Diffusion Temps Réel** : Utilise Socket.IO pour diffuser les nouvelles positions
 *     des avions à tous les clients connectés.
 * 6.  **Gestion de Base de Données** : Initialise la base de données SQLite, crée les
 *     tables nécessaires et importe des données statiques et historiques au démarrage.
 * 
 * Le serveur est conçu pour être le cœur de l'application, centralisant la logique
 * de récupération, de stockage et de distribution des données.
 * ===================================================================================
 */

// Importation des modules nécessaires pour le fonctionnement du serveur.
const fs = require("fs"); // Module pour les opérations sur le système de fichiers.
const path = require("path"); // Module pour manipuler les chemins de fichiers.
const express = require("express"); // Framework web pour Node.js.
const http = require("http"); // Module HTTP natif pour créer un serveur.
const { Server } = require("socket.io"); // Librairie pour la communication en temps réel (WebSockets).
// Importation dynamique de node-fetch v3 (module ESM) pour la compatibilité CommonJS.
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const sqlite3 = require('sqlite3').verbose(); // Module pour la base de données SQLite (mode verbeux).

/* ===================================================================================
   SECTION 1 : CONFIGURATION GÉNÉRALE ET INITIALISATION
===================================================================================
*/

const PORT = 8000; // Port d'écoute du serveur.

// --- Identifiants pour l'API OpenSky Network ---
const OS_CLIENT_ID = "tristan-api-client"; // Identifiant client pour l'authentification OpenSky.

const OS_CLIENT_SECRET = "RJEYgAQUUrXysgZ5buHsyG1i8gPDCeDF"; // Secret client pour l'authentification OpenSky.

let accessToken = null; // Variable pour stocker le token d'accès OAuth2 actuel d'OpenSky.
let tokenExpiresAt = 0; // Timestamp (en millisecondes) de l'expiration du token d'accès.

// Coordonnées de la "bounding box" pour la zone géographique à surveiller (Europe de l'Ouest).
const EUROPE_WEST = { lamin: 36.0, lomin: -11.0, lamax: 65.0, lomax: 25.0 };
const FR = EUROPE_WEST; // Alias 'FR' pour la France, utilisant la même zone géographique.

// Intervalle de base pour interroger l'API OpenSky (en millisecondes).
const POLL_MS_BASE = 60_000; // Intervalle de sondage de 60 secondes.
let pollMs = POLL_MS_BASE; // L'intervalle de sondage peut être ajusté dynamiquement en cas d'erreur (ex: limite de requêtes).

// --- Chemins de fichiers et de répertoires ---
const ROOT = __dirname; // Répertoire du script serveur actuel (public/scrapping).
const DATA_DIR = path.join(ROOT, "data"); // Répertoire pour les données temps réel (fichiers CSV de positions).
// Crée le répertoire 'data' s'il n'existe pas.
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ROOT_UP = path.join(ROOT, '..'); // Chemin vers le répertoire parent du script (public/).
const SHARED_DATA_DIR = path.join(ROOT_UP, 'data'); // Répertoire 'public/data' pour les données partagées.
// Crée le répertoire 'public/data' s'il n'existe pas.
if (!fs.existsSync(SHARED_DATA_DIR)) fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });
const DB_PATH = path.join(SHARED_DATA_DIR, 'traffic.db'); // Chemin complet vers le fichier de la base de données SQLite.

/* ===================================================================================
   SECTION 2 : GESTION DE LA BASE DE DONNÉES (SQLITE)
===================================================================================
*/

// Crée une seule connexion partagée à la base de données pour toute la durée de vie du serveur.
// Cela évite les problèmes de fermeture de handle et de concurrence lors d'opérations asynchrones.
const DB = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erreur de connexion à la base de données:', err);
    process.exit(1); // Arrête le serveur si la base de données ne peut pas être ouverte.
  }
  
  // Configure SQLite pour optimiser la concurrence et les performances.
  DB.configure('busyTimeout', 10000); // Timeout de 10 secondes si la base de données est occupée.
  DB.run('PRAGMA journal_mode = WAL'); // Active le mode "Write-Ahead Logging" pour un accès concurrentiel plus fiable.
  DB.run('PRAGMA synchronous = NORMAL'); // Équilibre entre la sécurité des données et la performance.
  DB.run('PRAGMA cache_size = -64000'); // Définit la taille du cache en mémoire à 64MB.
  DB.run('PRAGMA temp_store = MEMORY'); // Utilise la mémoire pour le stockage temporaire.
  console.log('Base de données configurée pour l\'accès concurrent.');
});

/**
 * Fonction utilitaire pour obtenir la connexion à la base de données partagée.
 * @returns {sqlite3.Database} L'instance de la base de données.
 */
function openDb() { return DB; }

// --- Système de file d'attente pour les insertions en base de données ---
// SQLite peut générer des erreurs "SQLITE_BUSY" si plusieurs écritures tentent d'accéder à la DB simultanément.
// Cette file d'attente sérialise toutes les opérations d'écriture pour les exécuter l'une après l'autre.
const insertQueue = []; // File d'attente des opérations d'insertion.
let isProcessingQueue = false; // Indicateur si la file d'attente est en cours de traitement.

/**
 * Ajoute une opération d'insertion à la file d'attente et lance le traitement si ce n'est pas déjà fait.
 * @param {string} sql La requête SQL à exécuter.
 * @param {Array<any>} params Les paramètres de la requête SQL.
 */
function queueInsert(sql, params) {
  insertQueue.push({ sql, params });
  processQueue(); // Tente de traiter la file d'attente.
}

/**
 * Traite la file d'attente des insertions. Exécute les requêtes une par une pour éviter les conflits.
 */
function processQueue() {
  // Ne fait rien si la file d'attente est déjà en cours de traitement ou est vide.
  if (isProcessingQueue || insertQueue.length === 0) return;
  
  isProcessingQueue = true; // Marque la file d'attente comme étant en cours de traitement.
  const db = openDb(); // Récupère l'instance de la base de données.
  
  // Fonction interne pour traiter la prochaine insertion.
  const processNext = () => {
    // Si la file d'attente est vide, le traitement est terminé.
    if (insertQueue.length === 0) {
      isProcessingQueue = false; // Réinitialise l'indicateur.
      return;
    }
    
    const { sql, params } = insertQueue.shift(); // Prend la première opération de la file d'attente.
    db.run(sql, params, (err) => {
      if (err) console.warn('Erreur d\'insertion via la file d\'attente:', err.message);
      // Utilise setImmediate pour passer à l'élément suivant sans bloquer l'Event Loop.
      setImmediate(processNext);
    });
  };
  
  processNext(); // Démarre le traitement de la première opération.
}

/**
 * Initialise la base de données au démarrage du serveur.
 * Crée les tables nécessaires si elles n'existent pas et importe des données JSON statiques.
 */
function initDbAndImportStatic() {
  const db = openDb(); // Récupère l'instance de la base de données.
  db.serialize(() => { // Exécute les requêtes SQL séquentiellement.
    // Les tables 'aircraft_types', 'airport_traffic', 'airline_delays', 'airport_delays'
    // sont généralement créées et remplies par des scripts d'importation dédiés.
    // On ne les recrée pas ici pour éviter les conflits et la perte de données.

    // Crée la table 'positions' si elle n'existe pas. Cette table stocke les données de positions d'avions.
    db.run(
      `CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, batch_key TEXT, ts_unix INTEGER, ts_iso TEXT,
        icao24 TEXT, callsign TEXT, origin_country TEXT, lat REAL, lon REAL,
        geo_alt_m REAL, baro_alt_m REAL, spd_ms REAL, hdg_deg REAL, vr_ms REAL, on_ground INTEGER
      )`
    );

    // Crée une table générique 'json_store' pour stocker des données JSON (ex: KPIs, configurations).
    db.run(`CREATE TABLE IF NOT EXISTS json_store (key TEXT PRIMARY KEY, json TEXT)`);

    // Importe les fichiers JSON statiques (comme 'kpis.json') dans la table 'json_store' s'ils existent.
    const kpisJson = path.join(SHARED_DATA_DIR, 'static', 'kpis.json');
    if (fs.existsSync(kpisJson)) {
      try {
        const txt = fs.readFileSync(kpisJson, 'utf8');
        // Insère ou remplace l'entrée 'kpis' dans 'json_store'.
        db.run('INSERT OR REPLACE INTO json_store(key, json) VALUES(?,?)', ['kpis', txt]);
      } catch (e) { console.warn('Échec de l\'import de kpis.json', e && e.message); }
    }
  });
}

// Appelle la fonction d'initialisation de la base de données au démarrage du serveur.
initDbAndImportStatic();
  
/**
 * Fonction auto-exécutée qui importe les fichiers CSV historiques de positions (nommés 'positions_*.csv')
 * dans la base de données. Elle vérifie les lots déjà importés pour éviter les doublons.
 */
(function importHistoricalCsvs(){
  try{
    // Lit tous les fichiers CSV de positions dans le répertoire DATA_DIR.
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('positions_') && f.endsWith('.csv')).sort();
    if (!files.length) return; // Ne fait rien si aucun fichier n'est trouvé.
    
    // Diffère l'importation pour ne pas bloquer le démarrage du serveur principal.
    setImmediate(() => {
      const db = openDb(); // Récupère l'instance de la base de données.
      // Récupère les clés de lot déjà présentes dans la base de données pour éviter les ré-importations.
      db.all('SELECT DISTINCT batch_key FROM positions', (err, rows) => {
        const existing = new Set((rows || []).map(r => r.batch_key)); // Crée un Set pour une recherche rapide.
        // Prépare l'instruction d'insertion SQL pour la table 'positions'.
        const ins = db.prepare(`INSERT OR IGNORE INTO positions(batch_key, ts_unix, ts_iso, icao24, callsign, origin_country, lat, lon, geo_alt_m, baro_alt_m, spd_ms, hdg_deg, vr_ms, on_ground) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        let totalInserted = 0; // Compteur des positions insérées.
        
        // Parcourt chaque fichier CSV historique.
        for (const f of files) {
          try {
            const batchKey = f.replace('.csv',''); // Extrait la clé de lot du nom de fichier.
            if (existing.has(batchKey)) continue; // Ignore le fichier s'il a déjà été importé.
            
            // Lecture et parsing manuel du CSV.
            const txt = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
            const lines = txt.trim().split(/\r?\n/).filter(Boolean); // Divise en lignes et filtre les vides.
            // Détermine si la première ligne est un en-tête.
            const startIdx = lines[0] && lines[0].toLowerCase().startsWith('ts_iso') ? 1 : 0;
            
            // Parcourt chaque ligne de données du CSV.
            for (let i = startIdx; i < lines.length; i++){
              const line = lines[i];
              const vals = []; // Valeurs de la ligne.
              let cur = ''; // Valeur de la colonne actuelle.
              let inQ = false; // Indicateur si entre guillemets.
              
              // Simple parser CSV.
              for (let j=0;j<line.length;j++){
                const ch = line[j];
                if (ch === '"') { if (inQ && line[j+1] === '"') { cur += '"'; j++; } else inQ = !inQ; }
                else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
                else cur += ch;
              }
              vals.push(cur); // Ajoute la dernière valeur.
              
              // Mappe les valeurs CSV aux champs de l'objet.
              const ts_iso = vals[0] || null;
              const ts_unix = ts_iso ? Math.floor(Date.parse(ts_iso)/1000) : null;
              const rowObj = {
                icao24: vals[1] || null, callsign: vals[2] || null, origin_country: vals[3] || null,
                lat: vals[4] ? Number(vals[4]) : null, lon: vals[5] ? Number(vals[5]) : null,
                geo_alt_m: vals[6] ? Number(vals[6]) : null, baro_alt_m: vals[7] ? Number(vals[7]) : null,
                spd_ms: vals[8] ? Number(vals[8]) : null, hdg_deg: vals[9] ? Number(vals[9]) : null,
                vr_ms: vals[10] ? Number(vals[10]) : null, on_ground: (vals[11]||'').toLowerCase() === 'true' ? 1 : 0
              };
              // Exécute l'insertion dans la base de données.
              ins.run(batchKey, ts_unix, ts_iso, rowObj.icao24, rowObj.callsign, rowObj.origin_country, rowObj.lat, rowObj.lon, rowObj.geo_alt_m, rowObj.baro_alt_m, rowObj.spd_ms, rowObj.hdg_deg, rowObj.vr_ms, rowObj.on_ground);
              totalInserted++; // Incrémente le compteur.
            }
          } catch(e) { console.warn('Échec de l\'import pour le fichier', f, e && e.message); }
        }
        
        // Finalise l'instruction préparée.
        ins.finalize((err) => {
          if (err) console.warn('Erreur lors de la finalisation de l\'import historique:', err.message);
          else if (totalInserted > 0) console.log(`${totalInserted} positions historiques importées.`);
        });
      });
    });
  } catch(e) { console.warn('Erreur globale dans importHistoricalCsvs', e && e.message); }
})();


/* ===================================================================================
   SECTION 3 : SERVEUR WEB (EXPRESS) ET TEMPS RÉEL (SOCKET.IO)
===================================================================================
*/

// Initialisation de l'application Express et du serveur HTTP.
const app = express();
const server = http.createServer(app);
// Initialisation de Socket.IO pour la communication en temps réel.
const io = new Server(server, { cors: { origin: "*" } }); // Permet toutes les origines pour CORS.

// Sert les fichiers statiques du dossier parent 'public'.
// Cela permet d'accéder aux ressources comme /js, /css, etc., depuis la racine du site.
app.use(express.static(path.join(ROOT, "..")));

// Sert également les fichiers du dossier 'scrapping' lui-même.
// Utile pour accéder à des ressources spécifiques au scrapping, comme 'index.html' pour la carte temps réel.
app.use(express.static(ROOT)); 
// Route par défaut qui sert le fichier 'index.html' du répertoire 'scrapping'.
app.get("/", (_, res) => res.sendFile(path.join(ROOT, "index.html")));

// Gère les connexions de clients via Socket.IO.
io.on("connection", (sock) => {
    // console.log("Client Socket.IO connecté:", sock.id) // Optionnel: décommenter pour le débogage.
});

/* ===================================================================================
   SECTION 4 : LOGIQUE DE COLLECTE DES DONNÉES (OPEN SKY NETWORK)
===================================================================================
*/

// --- Fonctions utilitaires pour la génération des CSV ---

/**
 * Génère une chaîne de caractères représentant l'heure actuelle au format YYYY-MM-DD_HH-MM.
 * Utilisée pour nommer les fichiers CSV.
 * @returns {string} La chaîne de temps formatée.
 */
function minuteStr() {
  const now = new Date();
  return now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
}

/**
 * Retourne le chemin complet vers un fichier CSV de positions pour une clé de temps donnée.
 * @param {string} timeKey La clé de temps (YYYY-MM-DD_HH-MM).
 * @returns {string} Le chemin du fichier CSV.
 */
function getCsvPath(timeKey) { return path.join(DATA_DIR, `positions_${timeKey}.csv`); }

/**
 * S'assure qu'un fichier CSV a un en-tête. Si le fichier n'existe pas, il est créé avec l'en-tête.
 * @param {string} p Le chemin du fichier CSV.
 */
function ensureCsvHeader(p) { 
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, "ts_iso,icao24,callsign,origin_country,lat,lon,geo_alt_m,baro_alt_m,spd_ms,hdg_deg,vr_ms,on_ground\n", "utf8");
  }
}

/**
 * Convertit un objet de données d'avion en une ligne CSV.
 * Les valeurs sont échappées si elles contiennent des virgules pour un format CSV correct.
 * @param {object} d L'objet de données d'avion.
 * @returns {string} La ligne CSV formatée.
 */
function toCsvRow(d) {
  // Fonction d'échappement pour les valeurs CSV.
  const esc = (v) => v == null ? "" : String(v).includes(",") ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [esc(d.ts_iso), esc(d.icao24), esc((d.callsign || "").trim()), esc(d.origin_country), esc(d.lat), esc(d.lon), esc(d.geo_alt_m), esc(d.baro_alt_m), esc(d.spd_ms), esc(d.hdg_deg), esc(d.vr_ms), esc(d.on_ground)].join(",");
}

/**
 * Gère l'obtention et le renouvellement du token d'accès OAuth2 pour l'API OpenSky.
 * Le token est réutilisé s'il est encore valide pour éviter des requêtes inutiles.
 * @returns {Promise<string>} Le token d'accès.
 * @throws {Error} En cas d'échec de l'obtention du token.
 */
async function getAccessToken() {
  const now = Date.now();

  // Si un token existe et est encore valide pour au moins 60 secondes, on le retourne.
  if (accessToken && now < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  const tokenUrl = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
  // Construit le corps de la requête pour l'obtention du token.
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: OS_CLIENT_ID, client_secret: OS_CLIENT_SECRET }).toString();

  // Effectue la requête POST pour obtenir le token.
  const res = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });

  // Gère les erreurs de la réponse HTTP.
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("Erreur d'obtention du token: " + res.status + " - " + txt);
  }

  // Parse la réponse JSON et stocke le token et sa date d'expiration.
  const json = await res.json();
  accessToken = json.access_token;
  const expiresIn = json.expires_in || 1800; // Durée de vie du token en secondes (par défaut 1800s = 30min).
  tokenExpiresAt = now + expiresIn * 1000; // Calcule le timestamp d'expiration.

  console.log("Nouveau token OpenSky récupéré. Expiration dans", expiresIn, "secondes.");
  return accessToken;
}

/**
 * Interroge l'API OpenSky pour obtenir l'état actuel des vols dans la zone géographique définie (FR).
 * @returns {Promise<object>} Un objet contenant la clé de lot, le timestamp et le tableau des états d'avions.
 * @throws {Error} En cas d'erreur HTTP de l'API OpenSky.
 */
async function fetchOpenSkyFrance() {
  const { lamin, lomin, lamax, lomax } = FR; // Destructure les coordonnées de la bounding box.
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`; // Construit l'URL de l'API.

  const token = await getAccessToken(); // Obtient un token d'accès valide.

  // Effectue la requête GET à l'API OpenSky avec le token d'autorisation.
  const res = await fetch(url, { headers: { "User-Agent": "edu-demo", Authorization: `Bearer ${token}` } });

  // Gère les erreurs de la réponse HTTP.
  if (!res.ok) {
    // Si le token est invalide (401 Unauthorized ou 403 Forbidden), on le vide pour forcer son renouvellement.
    if (res.status === 401 || res.status === 403) {
      accessToken = null;
      tokenExpiresAt = 0;
    }
    throw new Error("Erreur HTTP OpenSky " + res.status);
  }

  const data = await res.json(); // Parse la réponse JSON.
  const ts = data.time || Math.floor(Date.now() / 1000); // Récupère le timestamp des données.

  // Mappe les données brutes (un tableau de tableaux) en un format plus lisible (un tableau d'objets).
  const arr = (data.states || [])
    .map((s) => ({
      ts_iso: new Date((s[4] ?? ts) * 1000).toISOString(), // Timestamp ISO de la position.
      icao24: s[0], callsign: (s[1] || "").trim(), origin_country: s[2],
      lon: s[5], lat: s[6], baro_alt_m: s[7], on_ground: !!s[8],
      spd_ms: s[9], hdg_deg: s[10], vr_ms: s[11], geo_alt_m: s[13]
    }))
    // Filtre les données pour ne conserver que celles avec des coordonnées lat/lon valides.
    .filter(d => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)));

  const key = `${arr.length}@${ts}`; // Génère une clé unique pour ce lot de données.
  return { key, ts, arr }; // Retourne les données traitées.
}

// --- Variables pour la Boucle principale de "Polling" ---
let lastBatchKey = ""; // Clé du dernier lot de données traité.
let lastArr = []; // Dernier tableau d'états d'avions reçu.
const seenToday = new Set(); // Ensemble des ICAO24 uniques vus aujourd'hui.
let lastLoggedMinute = ""; // Minute du dernier log de données CSV.

/**
 * Planifie la prochaine exécution de la boucle de sondage après un certain délai.
 * Ajoute une petite gigue aléatoire pour éviter des requêtes parfaitement synchronisées.
 */
function scheduleNext() {
  const jitter = Math.floor(Math.random() * 5000); // Délai aléatoire (0-5 secondes).
  setTimeout(pollLoop, pollMs + jitter); // Planifie la prochaine exécution.
}

/**
 * Boucle principale qui interroge l'API OpenSky à intervalles réguliers.
 * Gère la récupération des données, leur persistance en CSV et DB, et leur diffusion en temps réel.
 */
async function pollLoop() {
  try {
    const { key, arr } = await fetchOpenSkyFrance(); // Récupère les données d'OpenSky.

    const currentMinuteKey = minuteStr(); // Clé de la minute actuelle.
    const currentCsvPath = getCsvPath(currentMinuteKey); // Chemin du fichier CSV pour la minute actuelle.

    // Si les données sont nouvelles (clé de lot différente du précédent)...
    if (key !== lastBatchKey) {
      lastBatchKey = key; // Met à jour la clé du dernier lot.

      // ...et si on a changé de minute (et qu'il y a des données), on écrit un nouveau fichier CSV.
      if (arr.length && currentMinuteKey !== lastLoggedMinute) {
        ensureCsvHeader(currentCsvPath); // S'assure que le fichier CSV a un en-tête.
        const lines = arr.map(toCsvRow).join("\n") + "\n"; // Formatte les données en lignes CSV.
        fs.writeFileSync(currentCsvPath, lines, "utf8"); // Écrit les données dans le fichier CSV.
        lastLoggedMinute = currentMinuteKey; // Met à jour la dernière minute loggée.
        console.log(`\n💾 Nouveau fichier CSV créé: ${currentMinuteKey}.csv`);
      }

      // Persiste les nouvelles données dans la table 'positions' de la base de données via la file d'attente.
      if (arr.length > 0) {
        const ts_unix = Math.floor((arr[0] && Date.parse(arr[0].ts_iso) / 1000) || Date.now() / 1000);
        for (const d of arr) {
          queueInsert(
            `INSERT INTO positions(batch_key, ts_unix, ts_iso, icao24, callsign, origin_country, lat, lon, geo_alt_m, baro_alt_m, spd_ms, hdg_deg, vr_ms, on_ground) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [key, ts_unix, d.ts_iso, d.icao24, d.callsign, d.origin_country, d.lat, d.lon, d.geo_alt_m, d.baro_alt_m, d.spd_ms, d.hdg_deg, d.vr_ms, d.on_ground ? 1 : 0]
          );
        }
      }

      // Met à jour la liste des avions uniques vus aujourd'hui.
      for (const d of arr) if (d.icao24) seenToday.add(d.icao24);

      lastArr = arr; // Stocke le dernier tableau de données.
      // Diffuse les nouvelles données à tous les clients connectés via Socket.IO.
      io.emit("data:batch", { batchKey: key, arr });

      console.log(`✔ ${new Date().toLocaleTimeString()} — ${arr.length} avions émis. Uniques aujourd'hui: ${seenToday.size}`);
    } else {
      // Si les données n'ont pas changé (même clé de lot), on rediffuse le dernier lot aux nouveaux clients.
      io.emit("data:batch", { batchKey: lastBatchKey, arr: lastArr });
    }

    pollMs = POLL_MS_BASE; // Réinitialise l'intervalle de polling à sa valeur de base en cas de succès.
  } catch (e) {
    const msg = String(e.message || e);
    console.warn("Erreur OpenSky:", msg);

    // En cas d'erreur de l'API, ajuste l'intervalle de polling (stratégie de "backoff exponentiel").
    if (msg.includes("HTTP 429")) { // Si "Too Many Requests".
      pollMs = Math.min(Math.round(pollMs * 1.8), 180_000); // Augmente l'intervalle jusqu'à 3 minutes.
    } else if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) { // Si erreur d'authentification.
      accessToken = null; // Invalide le token.
      tokenExpiresAt = 0; // Réinitialise l'expiration.
      pollMs = 180_000; // Augmente l'intervalle à 3 minutes.
    } else { // Pour toutes les autres erreurs (incluant 503).
      pollMs = Math.min(Math.round(pollMs * 1.5), 120_000); // Augmente l'intervalle jusqu'à 2 minutes.
    }
    
    // Si des données existaient, les rediffuse même en cas d'erreur pour les nouveaux clients.
    if (lastArr.length) io.emit("data:batch", { batchKey: lastBatchKey, arr: lastArr });
  } finally {
    // Planifie la prochaine exécution, quel que soit le succès ou l'échec de la requête actuelle.
    scheduleNext();
  }
}

/* ===================================================================================
   SECTION 5 : POINTS D'API (ENDPOINTS)
===================================================================================
*/

// --- API pour les données historiques (basées sur les fichiers CSV) ---

/**
 * Endpoint pour renvoyer la liste des fichiers CSV de positions historiques disponibles.
 * Ces fichiers sont générés par la logique de collecte de données et stockés localement.
 * @route GET /api/historical/files
 * @returns {Array<string>} Une liste de noms de fichiers CSV.
 */
app.get("/api/historical/files", (_, res) => {
  fs.readdir(DATA_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: "Erreur lecture répertoire historique." });
    // Filtre les fichiers .csv qui commencent par 'positions_' et les trie par ordre décroissant.
    const csvFiles = files.filter((f) => f.endsWith(".csv") && f.startsWith("positions_")).sort().reverse();
    res.json(csvFiles); // Renvoie la liste des fichiers CSV.
  });
});

/**
 * Endpoint pour renvoyer le contenu brut d'un fichier CSV de positions spécifique.
 * Le nom du fichier est passé en paramètre de l'URL.
 * @route GET /api/historical/data/:filename
 * @param {string} req.params.filename Le nom du fichier CSV à récupérer.
 * @returns {string} Le contenu du fichier CSV.
 */
app.get("/api/historical/data/:filename", (req, res) => {
  const filename = req.params.filename;
  // Valide le nom de fichier pour des raisons de sécurité (empêche les traversées de répertoire).
  if (!filename.endsWith(".csv") || !filename.startsWith("positions_") || filename.includes("..")) {
    return res.status(400).json({ error: "Nom de fichier invalide." });
  }
  const filePath = path.join(DATA_DIR, filename); // Construit le chemin complet du fichier.

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) return res.status(404).json({ error: "Fichier non trouvé ou illisible." });
    res.type("text/csv").send(data); // Définit le type de contenu et envoie les données.
  });
});

// --- API pour les graphiques du tableau de bord (basées sur la DB SQLite) ---

/**
 * Endpoint pour obtenir la répartition des avions par fabricant (utilisé pour le graphique "donut").
 * Les données proviennent de la table 'aircraft_manufacturer_counts' de la base de données.
 * @route GET /api/aircraft
 * @returns {Array<object>} Une liste d'objets { manufacturer_name, aircraft_count }.
 */
app.get('/api/aircraft', (req, res) => {
  const db = openDb();
  db.all('SELECT manufacturer_name, aircraft_count FROM aircraft_manufacturer_counts ORDER BY aircraft_count DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB: ' + err.message });
    res.json(rows || []); // Renvoie les données des fabricants.
  });
});

/**
 * Endpoint pour obtenir les données de trafic passagers par pays et année (utilisé pour le graphique à barres).
 * Les données proviennent de la table 'airport_traffic'.
 * @route GET /api/traffic
 * @returns {Array<object>} Une liste d'objets { country_code, year, passenger_count }.
 */
app.get('/api/traffic', (req, res) => {
  const db = openDb();
  db.all('SELECT country_code, year, passenger_count FROM airport_traffic ORDER BY year DESC, passenger_count DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    res.json(rows || []); // Renvoie les données de trafic aéroportuaire.
  });
});

/**
 * Endpoint pour obtenir le dernier lot de positions d'avions enregistré en base de données.
 * @route GET /api/positions/latest
 * @returns {object} Un objet { batchKey, rows } contenant la clé du lot et les positions.
 */
app.get('/api/positions/latest', (req, res) => {
  const db = openDb();
  // Récupère la clé et le timestamp du lot le plus récent.
  db.get('SELECT batch_key, ts_unix FROM positions ORDER BY ts_unix DESC LIMIT 1', (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'Erreur DB ou aucune donnée' });
    
    // Récupère toutes les positions associées à ce lot.
    db.all('SELECT ts_iso, icao24, callsign, origin_country, lat, lon, geo_alt_m, baro_alt_m, spd_ms, hdg_deg, vr_ms, on_ground FROM positions WHERE batch_key = ?', [row.batch_key], (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'Erreur DB' });
      res.json({ batchKey: row.batch_key, rows: rows || [] }); // Renvoie le lot de positions.
    });
  });
});

/**
 * Endpoint pour obtenir les données sur les retards des compagnies aériennes.
 * @route GET /api/delays/airlines
 * @returns {Array<object>} Une liste d'objets { region, name, onTime, flights }.
 */
app.get('/api/delays/airlines', (req, res) => {
  const db = openDb();
  db.all('SELECT region, airline_name as name, on_time_arrival as onTime, total_flights as flights FROM airline_delays', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur de base de données: ' + err.message });
    res.json(rows || []); // Renvoie les données de retards des compagnies.
  });
});

/**
 * Endpoint pour obtenir les données complètes sur les retards des aéroports, y compris pour les KPIs.
 * @route GET /api/delays/airports
 * @returns {Array<object>} Une liste d'objets { region, name, onTime, flights, avg_dep_delay_min }.
 */
app.get('/api/delays/airports', (req, res) => {
  const db = openDb();
  
  const sql = `
    SELECT 
        region, 
        airport_name as name, 
        on_time_departure as onTime, 
        total_flights as flights,
        avg_dep_delay_min  -- << Colonne ajoutée pour les indicateurs clés de performance (KPI)
    FROM airport_delays
  `;

  db.all(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB: ' + err.message });
    res.json(rows || []); // Renvoie les données de retards des aéroports.
  });
});

/**
 * Endpoint to calculate the average monthly passenger count from the airport_traffic table.
 * Assumes yearly data in airport_traffic and provides a global monthly average approximation.
 * @route GET /api/avg-monthly-passengers
 * @returns {object} An object { averageMonthlyPassengers: number }.
 */
app.get('/api/avg-monthly-passengers', (req, res) => {
  const db = openDb();
  db.all('SELECT year, SUM(passenger_count) as yearly_passengers FROM airport_traffic GROUP BY year', (err, rows) => {
    if (err) {
      console.error('Erreur DB lors du calcul des passagers mensuels moyens:', err.message);
      return res.status(500).json({ error: 'Erreur DB: ' + err.message });
    }

    if (!rows || rows.length === 0) {
      return res.json({ averageMonthlyPassengers: 0 });
    }

    let totalPassengers = 0;
    let numberOfYears = 0;

    rows.forEach(row => {
      totalPassengers += row.yearly_passengers;
      numberOfYears++;
    });

    const averageMonthlyPassengers = numberOfYears > 0 ? (totalPassengers / (numberOfYears * 12)) : 0;
    res.json({ averageMonthlyPassengers: Math.round(averageMonthlyPassengers) });
  });
});

/**
 * Endpoint pour obtenir les données statiques des KPIs (tendances, etc.).
 * Cherche d'abord en base de données, puis dans un fichier JSON si non trouvé.
 * @route GET /api/kpis
 * @returns {object} Un objet JSON contenant les données des KPIs.
 */
app.get('/api/kpis', (req, res) => {
  const db = openDb();
  db.get('SELECT json FROM json_store WHERE key = ?', ['kpis'], (err, row) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    if (row && row.json) {
      try { return res.json(JSON.parse(row.json)); } // Tente de parser et renvoyer le JSON de la DB.
      catch (e) { return res.status(500).json({ error: 'Erreur de parsing JSON' }); }
    }
    // Fallback : si non trouvé en DB, essaie de lire le fichier 'kpis.json'.
    const p = path.join(SHARED_DATA_DIR, 'static', 'kpis.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Non trouvé' });
    try { const txt = fs.readFileSync(p, 'utf8'); return res.json(JSON.parse(txt)); }
    catch (e) { return res.status(500).json({ error: 'Erreur de lecture' }); }
  });
});

// --- API pour la page "Historique" (basées sur la DB SQLite) ---

/**
 * Endpoint pour obtenir la liste des lots de positions disponibles, avec timestamp et nombre d'avions.
 * @route GET /api/historical/batches
 * @returns {Array<object>} Une liste d'objets { batch_key, ts_unix, count, label }.
 */
app.get('/api/historical/batches', (req, res) => {
  const db = openDb();
  // Regroupe les positions par clé de lot et compte les avions.
  db.all('SELECT batch_key, MIN(ts_unix) as ts_unix, COUNT(*) as count FROM positions GROUP BY batch_key ORDER BY ts_unix DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    // Formatte les lots pour l'affichage (avec un libellé lisible).
    const batches = (rows || []).map(r => ({
      batch_key: r.batch_key,
      ts_unix: r.ts_unix,
      count: r.count,
      label: r.ts_unix ? new Date(r.ts_unix * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : r.batch_key
    }));
    res.json(batches); // Renvoie la liste des lots.
  });
});

/**
 * Endpoint pour récupérer toutes les positions d'un lot spécifique.
 * La clé du lot est passée en paramètre de l'URL.
 * @route GET /api/historical/batch/:batchKey
 * @param {string} req.params.batchKey La clé du lot à récupérer.
 * @returns {Array<object>} Une liste d'objets représentant les positions d'avions du lot.
 */
app.get('/api/historical/batch/:batchKey', (req, res) => {
  const db = openDb();
  // Récupère toutes les positions pour la clé de lot spécifiée.
  db.all('SELECT ts_iso, icao24, callsign, origin_country, lat, lon, geo_alt_m, baro_alt_m, spd_ms, hdg_deg, vr_ms, on_ground FROM positions WHERE batch_key = ? ORDER BY id ASC', [req.params.batchKey], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    res.json(rows || []); // Renvoie les positions du lot.
  });
});

/**
 * Endpoint générique pour requêter des positions avec des filtres (depuis un timestamp et une limite).
 * @route GET /api/positions
 * @param {number} [req.query.since=0] Le timestamp UNIX minimal pour les positions (filtre les positions antérieures).
 * @param {number} [req.query.limit=1000] Le nombre maximal de positions à retourner (limité à 10000).
 * @returns {Array<object>} Une liste d'objets représentant les positions d'avions filtrées.
 */
app.get('/api/positions', (req, res) => {
  const since = Number(req.query.since) || 0; // Timestamp minimal.
  const limit = Math.min(10000, Number(req.query.limit) || 1000); // Limite le nombre de résultats.
  const db = openDb();
  db.all('SELECT ts_iso, icao24, callsign, origin_country, lat, lon, geo_alt_m, baro_alt_m, spd_ms, hdg_deg, vr_ms, on_ground, batch_key, ts_unix FROM positions WHERE ts_unix >= ? ORDER BY ts_unix ASC LIMIT ?', [since, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    res.json(rows || []); // Renvoie les positions filtrées.
  });
});

/* ===================================================================================
   SECTION 6 : POINTS D'API DE DEBUG ET D'ADMINISTRATION
=================================================================================== */

/**
 * Endpoint pour déclencher manuellement une requête à l'API OpenSky.
 * Utile pour le débogage ou pour forcer une mise à jour des données.
 * @route GET /api/fetch-now
 * @returns {object} Un objet { ok: boolean, count?: number, error?: string }.
 */
app.get("/api/fetch-now", async (_, res) => {
  try {
    const { arr } = await fetchOpenSkyFrance(); // Tente de récupérer les données.
    res.json({ ok: true, count: arr.length }); // Renvoie le nombre d'avions récupérés.
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) }); // Gère les erreurs.
  }
});

/**
 * Endpoint de débogage pour afficher le dernier lot de données d'avions en mémoire.
 * @route GET /api/debug
 * @returns {object} Un objet { count: number, sample: object|null } avec le nombre d'avions et un échantillon.
 */
app.get("/api/debug", (_, res) => res.json({ count: lastArr.length, sample: lastArr[0] || null }));

/**
 * Endpoint d'administration pour afficher un statut sommaire du contenu de la base de données.
 * Fournit des informations sur le nombre d'enregistrements dans les tables clés.
 * @route GET /api/admin/import-status
 * @returns {object} Un objet de statut détaillé de la base de données.
 */
app.get("/api/admin/import-status", (_, res) => {
  const db = openDb();
  // Compte le nombre d'enregistrements dans 'aircraft_types'.
  db.all('SELECT COUNT(*) as cnt FROM aircraft_types', (err, row) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    const aircraftCount = (row && row[0]) ? row[0].cnt : 0;
    // Compte le nombre d'enregistrements dans 'airport_traffic'.
    db.all('SELECT COUNT(*) as cnt FROM airport_traffic', (err2, row2) => {
      if (err2) return res.status(500).json({ error: 'Erreur DB' });
      const trafficCount = (row2 && row2[0]) ? row2[0].cnt : 0;
      // Compte les entrées dans 'json_store' par clé.
      db.all('SELECT key, COUNT(*) as cnt FROM json_store GROUP BY key', (err3, rows3) => {
        const jsonStatus = (rows3 || []).map(r => ({ key: r.key, count: r.cnt }));
        res.json({ // Renvoie un objet de statut.
          aircraft_types: aircraftCount,
          airport_traffic: trafficCount,
          json_store: jsonStatus,
          timestamp: new Date().toISOString()
        });
      });
    });
  });
});

/**
 * Endpoint simple pour vérifier que le serveur est en ligne et répond.
 * @route GET /health
 * @returns {object} Un objet { ok: true, time: string } indiquant l'état et l'heure actuels du serveur.
 */
app.get("/health", (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ===================================================================================
   SECTION 7 : DÉMARRAGE ET ARRÊT DU SERVEUR
===================================================================================
*/

// Démarre le serveur HTTP et le fait écouter sur le port spécifié.
server.listen(PORT, () => {
  console.log(`Serveur démarré. Dashboard disponible sur http://localhost:${PORT}`);
  // Lance la boucle de polling pour récupérer les données OpenSky en temps réel.
  pollLoop();
});

// Gère l'arrêt propre du serveur (par exemple, via Ctrl+C) pour s'assurer
// que la connexion à la base de données est correctement fermée avant de quitter.
process.on('SIGINT', () => {
  console.log('SIGINT reçu — fermeture de la connexion à la base de données...');
  DB.close(() => process.exit(0)); // Ferme la DB et quitte le processus.
});
// Gère l'événement de sortie du processus pour tenter de fermer la base de données.
process.on('exit', () => {
  try { DB.close(); } catch (e) { /* ignore */ } // Ignore les erreurs potentielles lors de la fermeture.
});