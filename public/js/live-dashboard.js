/**
 * @file Ce script gère le tableau de bord "temps réel".
 * Il calcule et affiche des KPIs et des graphiques à partir des données de vol
 * les plus récentes, qui sont soit poussées par `map-live.js` via `lastDisplayedBatch`,
 * soit récupérées depuis l'API ou le localStorage.
 */
(function() {
    // --- 1. CONFIGURATION ET SÉLECTION DES ÉLÉMENTS ---

    // URL du serveur pour les requêtes API.
    const SOCKET_URL = "http://localhost:8000";
    
    // Convertit la vitesse de m/s en km/h.
    const kmh = (ms) => (Number(ms) || 0) * 3.6;

    // Références aux éléments du DOM pour les KPIs.
    const els = {
        total: document.getElementById('kpiTotal'),
        onGround: document.getElementById('kpiOnGround'),
        pctGround: document.getElementById('kpiPctGround'),
        avgSpeed: document.getElementById('kpiAvgSpeed'),
        avgAlt: document.getElementById('kpiAvgAlt')
    };

    // Références aux éléments du DOM pour les filtres.
    const filters = {
        airline: document.getElementById('filterAirline'),
        country: document.getElementById('filterCountry'),
        minSpeed: document.getElementById('filterMinSpeed'),
        showGround: document.getElementById('filterShowGround')
    };

    // Variables pour stocker les instances des graphiques.
    let topAirlinesChart = null;
    let filtersPopulated = false; // Indicateur pour savoir si les filtres ont été remplis.

    // --- 2. INITIALISATION DES GRAPHIQUES (CHART.JS) ---

    /**
     * Crée les instances des deux graphiques du tableau de bord.
     */
    function buildCharts() {
        const topAirlinesCtx = document.getElementById('chartTopAirlines')?.getContext('2d');
        if (topAirlinesCtx) {
            topAirlinesChart = new Chart(topAirlinesCtx, {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Vols', data: [], backgroundColor: [], borderRadius: 8 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 300 },
                    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                    layout: { padding: { left: 6, right: 6, top: 6, bottom: 6 } },
                    scales: {
                        x: { ticks: { color: '#475569' }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { color: '#475569' }, grid: { color: 'rgba(15,23,42,0.06)' } }
                    }
                }
            });
        }


    }

    // --- 3. LOGIQUE DE TRAITEMENT DES DONNÉES ---

    /**
     * Filtre un tableau de données de vol en fonction des filtres actifs dans l'interface.
     * @param {Array<Object>} data - Le tableau de données de vol brutes.
     * @returns {Array<Object>} Le tableau de données filtrées.
     */
    function applyFiltersToData(data) {
        if (!data || !Array.isArray(data)) return [];

        const selAirline = filters.airline?.value || '';
        const selCountry = filters.country?.value || '';
        const minSpeedKmh = Number(filters.minSpeed?.value || 0);
        const showGround = !(filters.showGround && filters.showGround.checked === false);

        return data.filter(d => {
            if (!showGround && d.on_ground) return false;
            if (kmh(d.spd_ms || 0) < minSpeedKmh) return false;

            if (selAirline) {
                const callsign = (d.callsign || '').trim();
                const prefix = (callsign.match(/^[A-Z]{2,3}/) || [])[0] || '';
                if (!prefix || prefix !== selAirline) return false;
            }
            if (selCountry) {
                if ((d.origin_country || '').trim() !== selCountry) return false;
            }
            return true;
        });
    }

    /**
     * Calcule tous les KPIs et les données agrégées à partir d'un jeu de données de vol.
     * @param {Array<Object>} data - Données de vol (généralement déjà filtrées).
     * @returns {Object} Un objet contenant tous les KPIs calculés.
     */
    function computeKPIs(data) {
        const total = data.length;
        const onGround = data.filter(d => d.on_ground).length;
        const pctGround = total ? Math.round(1000 * (onGround / total)) / 10 : 0;

        const speeds = data.map(d => kmh(d.spd_ms)).filter(s => s > 0);
        const avgSpeed = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;

        const alts = data.map(d => Number(d.geo_alt_m ?? d.baro_alt_m)).filter(isFinite);
        const avgAlt = alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length) : 0;

        // Compte les vols par préfixe de callsign pour trouver les compagnies les plus actives.
        const counts = {};
        for (const d of data) {
            const callsign = (d.callsign || '').trim();
            const prefix = (callsign.match(/^[A-Z]{2,3}/) || [])[0] || 'UNK';
            counts[prefix] = (counts[prefix] || 0) + 1;
        }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

        return { total, onGround, pctGround, avgSpeed, avgAlt, top };
    }

    // --- 4. MISE À JOUR DE L'INTERFACE ---

    /**
     * Met à jour les éléments du DOM (KPIs et graphiques) avec les nouvelles données.
     * @param {Object} kpis - L'objet de KPIs retourné par `computeKPIs`.
     */
    function updateUI(kpis) {
        if (els.total) els.total.textContent = kpis.total.toLocaleString('fr-FR');
        if (els.onGround) els.onGround.textContent = kpis.onGround.toLocaleString('fr-FR');
        if (els.pctGround) els.pctGround.textContent = `${kpis.pctGround}%`;
        if (els.avgSpeed) els.avgSpeed.textContent = kpis.avgSpeed ? `${kpis.avgSpeed} km/h` : '—';
        if (els.avgAlt) els.avgAlt.textContent = kpis.avgAlt ? `${kpis.avgAlt} m` : '—';

        // Met à jour le graphique des compagnies les plus actives.
        if (topAirlinesChart) {
            const labels = kpis.top.map(t => t[0]);
            const values = kpis.top.map(t => t[1]);
            const colorsPalette = [
                '#6366f1', // Indigo
                '#3b82f6', // Blue
                '#06b6d4', // Cyan
                '#10b981', // Emerald
                '#84cc16', // Lime
                '#ef4444', // Red
                '#f97316', // Orange
                '#eab308', // Yellow
                '#a855f7', // Purple
                '#ec4899'  // Pink
            ];
            const colors = labels.map((_, i) => colorsPalette[i % colorsPalette.length]);
            topAirlinesChart.data.labels = labels;
            topAirlinesChart.data.datasets[0].data = values;
            topAirlinesChart.data.datasets[0].backgroundColor = colors;
            topAirlinesChart.update();
        }


    }

    let previousKpis = null; // Cache pour éviter les rafraîchissements inutiles.

    /**
     * Compare deux objets de KPIs pour voir s'ils sont identiques.
     * @returns {boolean} `true` si les KPIs sont les mêmes.
     */
    function kpisEqual(a, b) {
        if (!a || !b) return false;
        const keys = ['total', 'onGround', 'pctGround', 'avgSpeed', 'avgAlt'];
        if (keys.some(k => a[k] !== b[k])) return false;
        
        const topA = (a.top || []).map(x => `${x[0]}:${x[1]}`).join(',');
        const topB = (b.top || []).map(x => `${x[0]}:${x[1]}`).join(',');
        return topA === topB;
    }

    /**
     * Remplit les menus déroulants des filtres avec les compagnies et pays extraits des données.
     * @param {Array<Object>} data - Données de vol.
     */
    function populateFilters(data) {
        if (!Array.isArray(data) || data.length === 0 || !filters.airline || !filters.country) return;
        
        try {
            const airlineSet = new Set();
            const countrySet = new Set();
            for (const d of data) {
                const prefix = ((d.callsign || '').match(/^[A-Z]{2,3}/) || [])[0];
                if (prefix) airlineSet.add(prefix);
                if (d.origin_country) countrySet.add(String(d.origin_country).trim());
            }
            const airlineArr = Array.from(airlineSet).sort();
            const countryArr = Array.from(countrySet).sort();

            const selAirline = filters.airline.value;
            filters.airline.innerHTML = '<option value="">Toutes les compagnies</option>' + airlineArr.map(a => `<option value="${a}">${a}</option>`).join('');
            if (selAirline) filters.airline.value = selAirline;

            const selCountry = filters.country.value;
            filters.country.innerHTML = '<option value="">Tous les pays</option>' + countryArr.map(c => `<option value="${c}">${c}</option>`).join('');
            if (selCountry) filters.country.value = selCountry;

            filtersPopulated = true;
        } catch (e) { console.warn('Erreur lors du remplissage des filtres:', e); }
    }

    // --- 5. BOUCLE DE RAFRAÎCHISSEMENT ET GESTION DES DONNÉES ---

    /**
     * Fonction principale de rafraîchissement, appelée périodiquement.
     */
    function refresh() {
        try {
            // Récupère les données depuis la variable globale, ou le localStorage en fallback.
            let data = window.lastDisplayedBatch || null;
            if (!data?.length && typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('sky_aircraft_last_batch_v1');
                if (raw) data = (JSON.parse(raw).batch || []);
            }
            data = data || [];

            if (!filtersPopulated) populateFilters(data);

            const filteredData = applyFiltersToData(data);
            const kpis = computeKPIs(filteredData);
            
            // Ne met à jour l'UI que si les données ont changé pour éviter le scintillement.
            if (!kpisEqual(previousKpis, kpis)) {
                updateUI(kpis);
                previousKpis = kpis;
            }
        } catch (e) { console.error('Erreur lors du rafraîchissement du live-dashboard:', e); }
    }

    /**
     * Récupère le dernier lot de données depuis le serveur via l'API.
     * @returns {Promise<boolean>} `true` en cas de succès.
     */
    async function fetchLatestFromServer() {
        try {
            const res = await fetch(`${SOCKET_URL}/api/positions/latest`);
            if (!res.ok) throw new Error('API indisponible');
            
            const payload = await res.json();
            const batchArr = Array.isArray(payload) ? payload : (payload?.rows || payload?.arr || []);
            
            if (!Array.isArray(batchArr)) throw new Error('Format de données invalide');
            
            // Met en cache les données récupérées dans le localStorage.
            localStorage.setItem('sky_aircraft_last_batch_v1', JSON.stringify({ ts: Date.now(), batch: batchArr }));
            window.lastDisplayedBatch = batchArr; // Met à jour la variable globale.

            previousKpis = null; // Force le rafraîchissement de l'UI.
            if (!filtersPopulated) populateFilters(batchArr);
            refresh();

            const lastSyncEl = document.getElementById('lastSync');
            if (lastSyncEl) lastSyncEl.textContent = new Date().toLocaleString('fr-FR');
            return true;
        } catch (e) {
            console.warn('Échec de la récupération des dernières données serveur:', e);
            return false;
        }
    }

    // --- 6. INITIALISATION ET GESTIONNAIRES D'ÉVÉNEMENTS ---

    /**
     * Point d'entrée : attend que Chart.js soit chargé, puis initialise tout.
     */
    function init() {
        if (typeof Chart === 'undefined') {
            setTimeout(init, 200); // Réessaie si Chart.js n'est pas encore prêt.
            return;
        }
        buildCharts();
        fetchLatestFromServer().then(() => {
            refresh();
            // Lance le rafraîchissement périodique.
            setInterval(refresh, 2000);
        });
    }

    init();

    // Écoute les événements personnalisés pour un rafraîchissement immédiat.
    window.addEventListener('skyvis:batch', refresh);
    window.addEventListener('storage', (ev) => {
        if (ev.key === 'sky_aircraft_last_batch_v1') {
            refresh();
        }
    });

    // Lie les événements 'change' sur les filtres pour rafraîchir les données.
    Object.values(filters).forEach(filter => {
        if (filter) {
            filter.addEventListener('change', () => {
                previousKpis = null; // Force la mise à jour
                refresh();
            });
        }
    });

    // Gère le bouton de rafraîchissement manuel.
    const refreshBtn = document.getElementById('refreshServerBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳ Chargement...';
            await fetchLatestFromServer();
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Rafraîchir';
        });
    }
})();
