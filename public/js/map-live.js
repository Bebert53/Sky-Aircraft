/**
 * @file map-live.js
 * Ce script est le cœur de la carte de visualisation du trafic aérien en temps réel.
 * Il gère l'initialisation de la carte Leaflet, la connexion au serveur via WebSockets
 * (en utilisant un SharedWorker pour l'efficacité), l'affichage et la mise à jour
 * des avions, les filtres, et les KPIs associés.
 */

// ===================================================================================
// SECTION 1 : CONFIGURATION ET CONSTANTES
// ===================================================================================

const SOCKET_URL = "http://localhost:8000"; // URL du serveur WebSocket
const EUROPE_WEST_BOUNDS = L.latLngBounds([[36.0, -11.0], [65.0, 25.0]]); // Bounding box pour l'Europe

// Préfixes IATA de quelques compagnies pour le filtre rapide
const AIRLINE_PREFIXES = {
    'AF': 'Air France', 'LH': 'Lufthansa', 'BA': 'British Airways',
    'KL': 'KLM', 'RYR': 'Ryanair', 'EZY': 'EasyJet',
    'AAL': 'American Airlines', 'DAL': 'Delta Airlines', 'UAE': 'Emirates',
};

const LOCAL_BATCH_KEY = 'sky_aircraft_last_batch_v1'; // Clé pour le cache local du dernier lot de données

// ===================================================================================
// SECTION 2 : ÉTAT DE L'APPLICATION ET SÉLECTION DES ÉLÉMENTS DU DOM
// ===================================================================================

// --- État de la carte et des données ---
let map, layerGroup, tooltip;
let aircraftMarkers = new Map(); // Stocke les marqueurs Leaflet des avions (key: icao24, value: L.Marker)
let countries = new Set(); // Ensemble des pays d'origine des avions actuellement affichés
let lastDisplayedBatch = []; // Le dernier lot de données complet reçu et affiché
let isProcessing = false; // Verrou pour éviter les traitements concurrents (ex: rendu pendant un autre rendu)

// --- État de la connexion et de la communication ---
let sharedPort = null; // Port de communication avec le SharedWorker (si supporté)
let bc = null; // BroadcastChannel pour l'élection d'un onglet "maître"
let isMaster = false; // `true` si cet onglet est le maître qui gère la connexion WebSocket
let lastBatchKey = null; // Clé du dernier lot reçu du serveur pour éviter les rendus de données en double

// --- Références aux éléments du DOM ---
const loader = document.getElementById('loaderOverlay');
const mapModeTitle = document.getElementById('map-mode-title');
const dataSourceSpan = document.getElementById('current-data-source');
const statusDot = document.getElementById('statusDot');


// ===================================================================================
// SECTION 3 : FONCTIONS UTILITAIRES GÉNÉRALES
// ===================================================================================

/** Affiche l'indicateur de chargement. */
function showLoader() { if (loader) loader.classList.remove('hidden'); }

/** Masque l'indicateur de chargement. */
function hideLoader() { if (loader) loader.classList.add('hidden'); }

/**
 * Sauvegarde le dernier lot de données dans le localStorage pour une récupération
 * rapide lors de la navigation entre les pages.
 * @param {Array<Object>} batchArr - Le tableau de données d'avions.
 */
function saveBatchToLocal(batchArr) {
    try {
        const payload = { ts: Date.now(), batch: batchArr };
        localStorage.setItem(LOCAL_BATCH_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn("Impossible d'écrire dans le localStorage:", e);
    }
}

/**
 * Charge le dernier lot de données depuis le localStorage.
 * @returns {Object|null} Le lot de données avec son timestamp, ou null si non trouvé/invalide.
 */
function loadBatchFromLocal() {
    try {
        const s = localStorage.getItem(LOCAL_BATCH_KEY);
        if (!s) return null;
        return JSON.parse(s);
    } catch (e) {
        console.error("Erreur de lecture du cache local:", e);
        return null;
    }
}


// ===================================================================================
// SECTION 4 : INITIALISATION DE LA CARTE ET UTILITAIRES D'INTERFACE
// ===================================================================================

/**
 * Initialise la carte Leaflet, son fond de carte et le groupe de calques pour les avions.
 */
function initMap() {
    map = L.map('map', { zoomSnap: 0.25 }).fitBounds(EUROPE_WEST_BOUNDS);

    // Thème de carte clair et minimaliste de CartoDB
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 10,
        minZoom: 4,
    }).addTo(map);

    layerGroup = L.layerGroup().addTo(map);
    tooltip = document.getElementById('tooltip');
}

/** Convertit la vitesse de m/s en km/h. */
const kmhFromMs = (ms) => Math.round((Number(ms) || 0) * 3.6);

/** Retourne une classe CSS en fonction de la vitesse de l'avion. */
const speedClass = (ms) => {
    const kmh = kmhFromMs(ms);
    if (kmh >= 700) return 'speed-high';
    if (kmh >= 300) return 'speed-mid';
    return 'speed-low';
};

/** Génère une clé unique pour un avion. */
const mkKey = (d) => d.icao24 || d.callsign || Math.random().toString(36).slice(2);

/** Formate le callsign pour l'affichage. */
const formatCallsign = (cs) => (cs && cs.trim()) ? cs.trim() : '—';


/**
 * Affiche l'infobulle (tooltip) avec les informations d'un avion.
 * @param {L.LeafletMouseEvent} e - L'événement de la souris.
 * @param {Object} d - Les données de l'avion.
 */
function showTooltip(e, d) {
    const { originalEvent } = e;
    tooltip.classList.remove('hidden');
    tooltip.style.left = originalEvent.clientX + 'px';
    tooltip.style.top = originalEvent.clientY + 'px';
    const alt = Math.round(Number(d.geo_alt_m ?? d.baro_alt_m ?? 0));
    tooltip.innerHTML = `
      <strong>${formatCallsign(d.callsign)}</strong><br/>
      Pays d'origine: ${d.origin_country || '—'}<br/>
      Altitude: ${alt.toLocaleString('fr-FR')} m<br/>
      Vitesse: ${kmhFromMs(d.spd_ms)} km/h<br/>
      Cap: ${Math.round(Number(d.hdg_deg || 0))}°<br/>
      Au sol: ${d.on_ground ? 'Oui' : 'Non'}<br/>
      ICAO24: ${d.icao24 || '—'}
    `;
}

/** Masque l'infobulle. */
const hideTooltip = () => tooltip.classList.add('hidden');

/**
 * Met à jour les KPIs affichés sur la carte.
 * @param {number} nowCount - Le nombre d'avions actuellement visibles.
 */
function updateKPIs(nowCount) {
    const kpiNowEl = document.getElementById('kpiNow');
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (kpiNowEl) kpiNowEl.textContent = nowCount.toLocaleString('fr-FR');
    if (lastUpdateEl) lastUpdateEl.textContent = 'Dernière mise à jour : ' + new Date().toLocaleTimeString();
}

// ===================================================================================
// SECTION 5 : GESTION DES FILTRES
// ===================================================================================

/**
 * Vérifie si un avion correspond aux filtres actuellement sélectionnés dans l'UI.
 * @param {Object} d - Les données de l'avion.
 * @returns {boolean} `true` si l'avion doit être affiché.
 */
function applyFilters(d) {
    const minAlt = Number(document.getElementById('minAlt').value || 0);
    const country = document.getElementById('countrySelect').value;
    const minSpeed = Number(document.getElementById('minSpeed').value || 0);
    const airline = document.getElementById('airlineFilter').value;

    // Le filtre 'showGround' est retiré de la logique, on affiche toujours les avions au sol.
    const alt = Number(d.geo_alt_m ?? d.baro_alt_m ?? 0);
    const speed = kmhFromMs(d.spd_ms);

    if (alt < minAlt) return false;
    if (country && d.origin_country !== country) return false;
    if (speed < minSpeed) return false;
    if (airline && !(d.callsign || '').startsWith(airline)) return false;

    return true;
}

/**
 * Met à jour le menu déroulant des pays avec les pays extraits des données actuelles.
 * La fonction préserve la sélection actuelle si possible et trie la liste.
 */
function refreshCountrySelect() {
    const select = document.getElementById('countrySelect');
    if (!select) return;

    const currentValue = select.value;
    const existingOptions = new Set(Array.from(select.options).map(opt => opt.value));

    countries.forEach(c => {
        if (c && !existingOptions.has(c)) {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            select.appendChild(opt);
        }
    });
    
    // Trie la liste des pays pour une meilleure navigation
    const options = Array.from(select.options);
    const sorted = options.slice(1).sort((a, b) => a.text.localeCompare(b.text)); // slice(1) pour ignorer "Tous les pays"
    sorted.forEach(opt => select.appendChild(opt));
    
    select.value = currentValue;
}


/**
 * Initialise le filtre des compagnies aériennes avec la liste prédéfinie.
 */
function initAirlineFilter() {
    const select = document.getElementById('airlineFilter');
    if (!select) return;

    for (const prefix in AIRLINE_PREFIXES) {
        const opt = document.createElement('option');
        opt.value = prefix;
        opt.textContent = `${AIRLINE_PREFIXES[prefix]} (${prefix})`;
        select.appendChild(opt);
    }
}

// ===================================================================================
// SECTION 6 : GESTION DES MARQUEURS ET DU RENDU
// ===================================================================================

/**
 * Crée ou met à jour un marqueur d'avion sur la carte.
 * Cette fonction est optimisée pour créer un nouveau marqueur si l'avion n'existe pas,
 * ou pour simplement mettre à jour la position et l'icône d'un marqueur existant.
 * @param {Object} d - Les données de l'avion.
 */
function upsertMarker(d) {
    const key = mkKey(d);
    const lat = Number(d.lat), lon = Number(d.lon);
    if (!isFinite(lat) || !isFinite(lon)) return; // Ignore les avions sans coordonnées valides

    const heading = Math.round(Number(d.hdg_deg || 0));
    const iconHtml = `<i class="fa-solid fa-plane ${speedClass(d.spd_ms)}" style="transform: rotate(${heading}deg);"></i>`;
    
    const icon = L.divIcon({
        className: 'custom-plane-icon',
        html: iconHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    let marker = aircraftMarkers.get(key);
    if (!marker) {
        // --- Création ---
        marker = L.marker([lat, lon], { icon })
            .on('mousemove', (e) => showTooltip(e, d))
            .on('mouseout', hideTooltip)
            .addTo(layerGroup);
        aircraftMarkers.set(key, marker);
    } else {
        // --- Mise à jour ---
        marker.setLatLng([lat, lon]);
        // Met à jour l'icône directement pour la performance, évite de recréer l'icône Leaflet
        if (marker.getElement()) {
            marker.getElement().innerHTML = iconHtml;
        }
    }
}

/**
 * Fonction centrale pour traiter et afficher un lot complet de données d'avions.
 * Elle efface les anciens marqueurs, applique les filtres et affiche les nouveaux.
 * @param {Array<Object>} dataArray - Le tableau de données d'avions à afficher.
 */
function processBatchAndRender(dataArray) {
    if (isProcessing) return;
    isProcessing = true;
    showLoader();

    if (!Array.isArray(dataArray)) {
        hideLoader();
        isProcessing = false;
        return;
    }

    const newCountries = new Set();
    
    // Efface tous les marqueurs de la carte de manière optimisée
    layerGroup.clearLayers();
    aircraftMarkers.clear();

    let visibleAircraftCount = 0;
    for (const aircraftData of dataArray) {
        if (aircraftData.origin_country) {
            newCountries.add(aircraftData.origin_country);
        }
        if (applyFilters(aircraftData)) {
            upsertMarker(aircraftData);
            visibleAircraftCount++;
        }
    }
    
    countries = newCountries;
    refreshCountrySelect();
    
    updateKPIs(visibleAircraftCount);
    
    // Sauvegarde le lot traité et notifie les autres parties de l'application
    saveBatchToLocal(dataArray);
    window.dispatchEvent(new CustomEvent('skyvis:batch', { detail: { ts: Date.now(), count: visibleAircraftCount } }));
    
    hideLoader();
    isProcessing = false;
}


// ===================================================================================


// SECTION 7 : GESTION DE LA CONNEXION (SHARED WORKER / WEBSOCKET)


// ===================================================================================





/**


 * Établit la connexion au serveur.


 * Utilise un SharedWorker si disponible pour maintenir une seule connexion WebSocket


 * active même si plusieurs onglets de l'application sont ouverts.


 * Se rabat sur une connexion WebSocket directe si les SharedWorkers ne sont pas supportés.


 */


function connectSocket() {


    // Cas 1 : Utilisation d'un SharedWorker (préféré)


    if (window.SharedWorker && !sharedPort) {


        try {


            const worker = new SharedWorker('/js/shared-socket.js');


            sharedPort = worker.port;


            sharedPort.onmessage = (e) => handleSocketMessage(e.data);


            sharedPort.start();


            sharedPort.postMessage({ cmd: 'start' });


            console.log("Connexion initiée via SharedWorker.");


            return;


        } catch (err) {


            console.warn('Échec du SharedWorker, fallback sur WebSocket direct:', err);


            sharedPort = null;


        }


    }





    // Cas 2 : Fallback sur une connexion WebSocket directe


    console.log("Connexion via WebSocket direct.");


    const directSocket = io(SOCKET_URL, { transports: ["websocket", "polling"], timeout: 5000 });


    directSocket.on('connect', () => handleSocketMessage({ type: 'connect' }));


    directSocket.on('disconnect', () => handleSocketMessage({ type: 'disconnect' }));


    directSocket.on('data:batch', (payload) => handleSocketMessage({ type: 'data:batch', payload }));


}





/**


 * Gère tous les messages entrants, qu'ils proviennent du SharedWorker ou d'un WebSocket direct.


 * @param {Object} msg - Le message reçu du serveur.


 */


function handleSocketMessage(msg) {


    if (!msg || !msg.type) return;





    switch (msg.type) {


        case 'connect':


            statusDot.style.background = '#10b981'; // Vert = connecté


            fetchLatestPositions(); // Récupère les données fraîches dès la connexion


            break;


        case 'disconnect':


            statusDot.style.background = '#ef4444'; // Rouge = déconnecté


            break;


        case 'error':


            console.warn('Erreur du Worker/Socket:', msg.message);


            break;


        case 'data:batch':


            const payload = msg.payload;


            if (!payload) return;


            


            const key = payload.batchKey || payload.batch_key;


            // Évite de retraiter inutilement le même lot de données si la clé n'a pas changé.


            if (key && key === lastBatchKey) {


                hideLoader();


                return;


            }


            lastBatchKey = key;


            


            const dataArray = payload.rows || payload.arr || [];


            if (dataArray.length > 0) {


                lastDisplayedBatch = dataArray;


                processBatchAndRender(lastDisplayedBatch);


            }


            break;


    }


}





/**


 * Se déconnecte du serveur (ferme le port du SharedWorker ou le WebSocket direct).


 */


function disconnectSocket() {


    if (sharedPort) {


        sharedPort.postMessage({ cmd: 'stop' }); // Demande au worker de se déconnecter


        sharedPort.close();


        sharedPort = null;


    }


    // La logique pour le socket direct est gérée dans `switchDataSource`


    statusDot.style.background = '#64748b'; // Gris


}





// ===================================================================================


// SECTION 8 : GESTION DES SOURCES DE DONNÉES (LIVE / HISTORIQUE)


// ===================================================================================





/**


 * Récupère la liste des lots de données historiques disponibles depuis l'API.


 * @returns {Promise<string|null>} Le nom du fichier le plus récent, ou null en cas d'erreur.


 */


async function loadHistoricalFiles() {


    try {


        const res = await fetch(`${SOCKET_URL}/api/historical/batches`);


        if (!res.ok) throw new Error(`Erreur API ${res.status}`);


       


        const files = await res.json();


        const dataSourceSelect = document.getElementById('dataSourceSelect');


        if (!dataSourceSelect) return null;





        // Vide les anciennes options historiques


        while (dataSourceSelect.options.length > 2) {


            dataSourceSelect.remove(2);


        }


        


        const fragment = document.createDocumentFragment();


        files.forEach(item => {


            const opt = document.createElement('option');


            opt.value = item.batch_key;


            const label = new Date(item.ts_unix * 1000).toLocaleString('fr-FR');


            opt.textContent = `${label} — ${item.count} avions`;


            fragment.appendChild(opt);


        });


        dataSourceSelect.appendChild(fragment);





        return files.length > 0 ? files[0].batch_key : null;





    } catch (error) {


        console.error("Erreur de chargement des fichiers historiques:", error);


        return null;


    }


}





/**


 * Récupère le dernier lot de positions depuis l'API pour un affichage initial rapide.


 */


async function fetchLatestPositions() {


    try {


        const res = await fetch(`${SOCKET_URL}/api/positions/latest`);


        if (!res.ok) throw new Error('API indisponible');


        


        const json = await res.json();


        const rows = json.rows || json.arr || [];


        if (rows.length > 0) {


            lastDisplayedBatch = rows;


            lastBatchKey = json.batchKey || json.batch_key;


            processBatchAndRender(lastDisplayedBatch);


        }


    } catch (e) {


        console.warn('Échec de la récupération des positions récentes:', e);


    }


}





/**


 * Change la source de données entre le mode LIVE et un fichier historique.


 * @param {string} sourceFilename - "LIVE" ou le nom du fichier de batch.


 */


async function switchDataSource(sourceFilename) {


    showLoader();


    disconnectSocket();


    


    if (sourceFilename === "LIVE") {


        mapModeTitle.textContent = "Trafic Aérien Live — Europe";


        dataSourceSpan.textContent = "LIVE";


        connectSocket();


        // Le rendu se fera au premier message reçu du socket


    } else {


        mapModeTitle.textContent = `Historique — ${sourceFilename.replace('positions_', '').replace('.csv', '').replace('_', ' ').replace('-', ':')}`;


        dataSourceSpan.textContent = "HISTORIQUE";


        


        try {


            const res = await fetch(`${SOCKET_URL}/api/historical/batch/${encodeURIComponent(sourceFilename)}`);


            if (!res.ok) throw new Error(`Échec de la récupération du batch ${sourceFilename}.`);


            


            lastDisplayedBatch = await res.json();


            processBatchAndRender(lastDisplayedBatch);


        } catch (error) {


            console.error("Erreur de chargement des données historiques:", error);


            processBatchAndRender([]); // Vide la carte en cas d'erreur


        }


    }


}








// ===================================================================================


// SECTION 9 : DÉMARRAGE DE L'APPLICATION ET GESTIONNAIRES D'ÉVÉNEMENTS


// ===================================================================================





/**


 * Point d'entrée principal de l'application.


 */


function startApp() {


    showLoader();


    initMap();


    initAirlineFilter();


    loadHistoricalFiles(); // Charge la liste des fichiers historiques en arrière-plan





    // Tente de restaurer depuis le cache local pour un affichage quasi-instantané


    const cached = loadBatchFromLocal();


    if (cached?.batch?.length && (Date.now() - cached.ts) < 120000) { // Cache de moins de 2 minutes


        lastDisplayedBatch = cached.batch;


        processBatchAndRender(lastDisplayedBatch);


        setTimeout(connectSocket, 500); // Connexion différée pour ne pas bloquer le rendu initial


    } else {


        connectSocket(); // Connexion immédiate si pas de cache récent


    }





    // Assure que la carte s'affiche correctement après le chargement et au redimensionnement


    setTimeout(() => map.invalidateSize(), 400);


    window.addEventListener('load', () => setTimeout(() => map.invalidateSize(), 150));


    window.addEventListener('resize', () => map.invalidateSize());


}





/**


 * Gère les changements sur les filtres de la carte.


 */


function handleFilterChange() {


    // Utilise un timeout pour regrouper les changements rapides et éviter de surcharger le rendu


    setTimeout(() => {


        if (!isProcessing) {


            processBatchAndRender(lastDisplayedBatch);


        }


    }, 50);


}





// --- Liaison des événements ---


document.getElementById('fitBtn').addEventListener('click', () => map.fitBounds(EUROPE_WEST_BOUNDS));


document.getElementById('countrySelect').addEventListener('change', handleFilterChange);


document.getElementById('showGround').addEventListener('change', handleFilterChange);


document.getElementById('minAlt').addEventListener('change', handleFilterChange);


document.getElementById('minSpeed').addEventListener('change', handleFilterChange);


document.getElementById('airlineFilter').addEventListener('change', handleFilterChange);


const dataSourceSelect = document.getElementById('dataSourceSelect');


if(dataSourceSelect) {


    dataSourceSelect.addEventListener('change', (e) => switchDataSource(e.target.value));


}








// Lancement de l'application


startApp();

