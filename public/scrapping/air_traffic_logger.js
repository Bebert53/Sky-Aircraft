/**
 * Mini logger trafic aérien (Europe) - OpenSky -> CSV par MINUTE
 * Usage:
 * node air_traffic_logger.js
 * Prérequis: Node >= 18
 *
 * Ce script:
 * - interroge OpenSky toutes les 15 s (bbox Europe),
 * - écrit/écrase un fichier CSV par minute (positions_YYYY-MM-DD_HH-MM.csv),
 * - maintient le comptes ico24 uniques du jour (state/daily_seen_YYYY-MM-DD.json).
 */

// Importe les modules nécessaires
import fs from "node:fs"; // Module pour interagir avec le système de fichiers
import path from "node:path"; // Module pour gérer les chemins de fichiers
import { setTimeout as wait } from "node:timers/promises"; // Fonction pour attendre de manière asynchrone

// ---------- Configuration (modifiable si besoin) ----------
const POLL_MS = 15_000; // 15 s : cadence de sondage rapide de l'API OpenSky
// BBox Europe (Ouest et Centrale) : définit la zone géographique à surveiller (latitude/longitude min/max)
const FR_BBOX = { lamin: 36.0, lomin: -11.0, lamax: 65.0, lomax: 25.0 };
// Si tu as un compte OpenSky, tu peux utiliser la Basic Auth: https://USERNAME:PASSWORD@opensky-network.org
// URL de base de l'API OpenSky pour récupérer les états des vols
const OPEN_SKY_BASE = "https://opensky-network.org/api/states/all";

// Dossiers de sortie pour les données et l'état
const DATA_DIR = path.resolve("data"); // Répertoire où seront stockés les fichiers CSV de positions
const STATE_DIR = path.resolve("state"); // Répertoire où sera stocké l'état journalier des avions vus
// Crée les répertoires s'ils n'existent pas (recursive: true permet de créer les répertoires parents si nécessaire)
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

// État de la journée pour le suivi des avions uniques
let currentDay = todayStr(); // Stocke la date actuelle sous forme de chaîne (YYYY-MM-DD)
let seen = new Set(); // Un Set pour stocker les identifiants ICAO24 uniques des avions vus aujourd'hui
let lastLoggedMinute = ""; // Variable pour suivre la minute du dernier log, afin de créer un nouveau fichier CSV chaque minute

/**
 * Génère la chaîne de caractères représentant la date actuelle (YYYY-MM-DD).
 * @returns {string} La date actuelle.
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Génère une clé de temps unique par minute en UTC (YYYY-MM-DD_HH-MM).
 * Utilisée pour nommer les fichiers CSV.
 * @returns {string} La clé de temps par minute.
 */
function minuteStr() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const h = String(now.getUTCHours()).padStart(2, '0');
    const min = String(now.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}_${h}-${min}`;
}

/**
 * Retourne le chemin complet vers le fichier JSON d'état pour un jour donné.
 * @param {string} day La date (YYYY-MM-DD).
 * @returns {string} Le chemin du fichier d'état.
 */
function statePathFor(day) {
  return path.join(STATE_DIR, `daily_seen_${day}.json`);
}

/**
 * Retourne le chemin complet vers le fichier CSV de positions pour une clé de temps donnée.
 * @param {string} timeKey La clé de temps (YYYY-MM-DD_HH-MM).
 * @returns {string} Le chemin du fichier CSV.
 */
function getCsvPath(timeKey) {
  return path.join(DATA_DIR, `positions_${timeKey}.csv`);
}

/**
 * S'assure qu'un fichier CSV a un en-tête. Si le fichier n'existe pas, il est créé avec l'en-tête.
 * @param {string} p Le chemin du fichier CSV.
 */
function ensureCsvHeader(p) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(
      p,
      "ts_iso,icao24,callsign,origin_country,lat,lon,geo_alt_m,baro_alt_m,spd_ms,hdg_deg,vr_ms,on_ground\n",
      "utf8"
    );
  }
}

/**
 * Convertit un objet de données d'avion en une ligne CSV.
 * Les valeurs sont échappées si elles contiennent des virgules.
 * @param {object} d L'objet de données d'avion.
 * @returns {string} La ligne CSV formatée.
 */
function toCsvRow(d) {
  // Fonction utilitaire pour échapper les valeurs pour le format CSV
  const esc = (v) =>
    v == null ? "" : String(v).includes(",") ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [
    esc(d.ts_iso),
    esc(d.icao24),
    esc((d.callsign || "").trim()),
    esc(d.origin_country),
    esc(d.lat),
    esc(d.lon),
    esc(d.geo_alt_m),
    esc(d.baro_alt_m),
    esc(d.spd_ms),
    esc(d.hdg_deg),
    esc(d.vr_ms),
    esc(d.geo_alt_m), // Correction: d.on_ground était manquant, et d.geo_alt_m était répété.
  ].join(",");
}

/**
 * Mappe un vecteur d'état brut d'OpenSky en un objet JavaScript lisible.
 * @param {Array<any>} s Le vecteur d'état brut.
 * @param {number} ts Le timestamp de la requête OpenSky.
 * @returns {object} L'objet de données d'avion mappé.
 */
function mapStateVector(s, ts) {
  return {
    ts_iso: new Date((s[4] ?? ts) * 1000).toISOString(), // Timestamp ISO de la position
    icao24: s[0], // Identifiant unique de l'avion (24-bit ICAO aircraft address)
    callsign: (s[1] || "").trim(), // Indicatif d'appel (ex: AF123)
    origin_country: s[2], // Pays d'origine de l'avion
    lon: s[5], // Longitude
    lat: s[6], // Latitude
    baro_alt_m: s[7], // Altitude barométrique en mètres
    on_ground: !!s[8], // Indique si l'avion est au sol
    spd_ms: s[9], // Vitesse sol en mètres/seconde
    hdg_deg: s[10], // Cap en degrés (0-359)
    vr_ms: s[11], // Taux de montée/descente en mètres/seconde
    geo_alt_m: s[13], // Altitude géométrique en mètres
  };
}

/**
 * Charge l'ensemble des identifiants ICAO24 vus pour un jour donné depuis un fichier JSON.
 * @param {string} day La date (YYYY-MM-DD).
 * @returns {Set<string>} Un Set contenant les identifiants ICAO24 vus.
 */
function loadSeenSet(day) {
  const p = statePathFor(day);
  if (fs.existsSync(p)) {
    try {
      const data = fs.readFileSync(p, "utf8");
      return new Set(JSON.parse(data));
    } catch (e) {
      console.warn("Erreur lecture state:", e.message); // Avertissement en cas d'erreur de lecture
      return new Set();
    }
  }
  return new Set();
}

/**
 * Sauvegarde l'ensemble des identifiants ICAO24 vus pour un jour donné dans un fichier JSON.
 * @param {string} day La date (YYYY-MM-DD).
 * @param {Set<string>} set Le Set d'identifiants ICAO24 à sauvegarder.
 */
function saveSeenSet(day, set) {
  const p = statePathFor(day);
  try {
    const arr = Array.from(set); // Convertit le Set en tableau pour la sérialisation JSON
    fs.writeFileSync(p, JSON.stringify(arr), "utf8");
  } catch (e) {
    console.warn("Erreur écriture state:", e.message); // Avertissement en cas d'erreur d'écriture
  }
}

/**
 * Interroge l'API OpenSky pour obtenir les états de vol dans la zone géographique définie (FR_BBOX).
 * @returns {Promise<object>} Une promesse qui résout avec les données JSON de l'API OpenSky.
 * @throws {Error} Si la requête HTTP échoue.
 */
async function fetchOpenSkyFrance() {
  const { lamin, lomin, lamax, lomax } = FR_BBOX; // Destructure la bounding box
  const url = `${OPEN_SKY_BASE}?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`; // Construit l'URL de la requête

  const res = await fetch(url, { headers: { "User-Agent": "edu-demo" } }); // Effectue la requête HTTP
  if (!res.ok) throw new Error("HTTP " + res.status); // Gère les erreurs HTTP

  return res.json(); // Retourne les données JSON de la réponse
}

/**
 * Boucle principale du logger. Interroge OpenSky, traite les données, les écrit dans des CSV
 * et met à jour le compte des avions uniques vus par jour.
 */
async function runLoop() {
  while (true) { // Boucle infinie pour un sondage continu
    try {
      const today = todayStr();
      // Vérifie si un nouveau jour a commencé
      if (today !== currentDay) {
        currentDay = today; // Met à jour le jour actuel
        seen = loadSeenSet(currentDay); // Charge l'état des avions vus pour le nouveau jour
        console.log(`📅 Nouveau jour détecté: ${currentDay} → compteur remis à zéro.`);
      }
      
      const data = await fetchOpenSkyFrance(); // Récupère les données d'OpenSky
      const ts = data.time || Math.floor(Date.now() / 1000); // Timestamp de la requête
      // Assure que 'states' est un tableau, sinon un tableau vide
      const states = Array.isArray(data.states) ? data.states : [];
      
      const currentMinuteKey = minuteStr(); // Clé de temps pour la minute actuelle
      const currentCsvPath = getCsvPath(currentMinuteKey); // Chemin du fichier CSV pour la minute actuelle

      // Filtrage simple: garde uniquement les états avec lat/lon valides
      const rows = []; // Tableau pour stocker les lignes CSV à écrire
      let newUniques = 0; // Compteur pour les nouveaux avions uniques vus

      for (const s of states) {
        const obj = mapStateVector(s, ts); // Mappe le vecteur d'état en objet lisible
        if (obj.lat === "" || obj.lon === "") continue; // Ignore si les coordonnées sont invalides

        // Ajoute la ligne CSV au tableau
        rows.push(toCsvRow(obj));

        // Met à jour le compteur unique du jour
        if (obj.icao24) {
          if (!seen.has(obj.icao24)) {
            seen.add(obj.icao24); // Ajoute l'avion au Set des avions vus
            newUniques++; // Incrémente le compteur de nouveaux uniques
          }
        }
      }
      
      // LOGIQUE D'ÉCRITURE À LA MINUTE DANS UN FICHIER CSV
      // Écrit un nouveau fichier CSV si des données sont présentes et que la minute a changé
      if (rows.length && currentMinuteKey !== lastLoggedMinute) {
        ensureCsvHeader(currentCsvPath); // S'assure que l'en-tête du CSV est présent
        
        // Écrit TOUT le contenu dans le nouveau fichier de la minute (écrasement)
        // Note: Le mode 'writeFileSync' écrase le fichier s'il existe déjà.
        // Si l'objectif était d'ajouter au fichier existant de la minute, il faudrait utiliser fs.appendFileSync.
        fs.writeFileSync(currentCsvPath, rows.join("\n") + "\n", "utf8");
        
        lastLoggedMinute = currentMinuteKey; // Met à jour la dernière minute loggée
        console.log(`💾 Fichier CSV créé/écrasé pour la minute: ${currentMinuteKey}.csv`);
      }


      // Sauvegarde l'état des avions uniques si de nouveaux uniques ont été vus
      if (newUniques > 0) {
        saveSeenSet(currentDay, seen);
      }

      const now = new Date().toLocaleTimeString(); // Heure locale actuelle pour le log
      console.log(
        `[${now}] +${rows.length} lignes enregistrées. Uniques today: ${seen.size}. Cadence: ${POLL_MS / 1000}s`
      );
    } catch (e) {
      console.warn(`⚠️ Erreur lecture OpenSky: ${e.message}`); // Avertissement en cas d'erreur de l'API OpenSky
    } finally {
      await wait(POLL_MS); // Attend l'intervalle défini avant la prochaine itération de la boucle
    }
  }
}

// Initialisation au démarrage du script
console.log(`--- Démarrage Logger Trafic Aérien (Europe) ---`);
runLoop(); // Démarre la boucle principale du logger