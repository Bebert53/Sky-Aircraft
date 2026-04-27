/**
 * Module de gestion des KPIs (Indicateurs Clés de Performance).
 * Ce script récupère les données depuis plusieurs points d'API pour calculer
 * et afficher les indicateurs principaux du tableau de bord.
 */
function initKpiWidget() {
    // Charge en parallèle les données depuis les trois API nécessaires.
    Promise.all([
        fetch('/api/kpis').then(response => response.json()), // Données générales (tendances, passagers)
        fetch('/api/delays/airports').then(response => response.json()), // Données sur les retards des aéroports
        fetch('/api/aircraft').then(response => response.json()), // Données sur la répartition des fabricants d'avions
        fetch('/api/avg-monthly-passengers').then(response => response.json()) // Données sur les passagers moyens par mois
    ])
    .then(([jsonData, airportsData, aircraftData, avgMonthlyPassengersData]) => {
        
 // --- 1. CALCULS À PARTIR DES DONNÉES DES AÉROPORTS ---
        let totalFlights = 0;
        let sumOfDelays = 0;
        const numberOfAirports = airportsData.length;

        // Itère sur les données de chaque aéroport
        airportsData.forEach(d => {
            // On utilise 'd.flights' (l'alias défini dans le SQL)
            // On utilise 'd.avg_dep_delay_min' (qu'on vient de rajouter dans le SQL)
            const nbVols = +(d.flights || d.total_flights || 0);
            totalFlights += d.flights || 0; 
            sumOfDelays += d.avg_dep_delay_min || 0;
        });

        // Calcule les moyennes.
        const avgFlightsPerAirport = numberOfAirports > 0 ? (totalFlights / numberOfAirports) : 0;
        const avgDelayPerAirport = numberOfAirports > 0 ? (sumOfDelays / numberOfAirports) : 0;

        // --- 2. TRAITEMENT DES DONNÉES DES FABRICANTS D'AVIONS ---
        // L'API '/api/aircraft' renvoie déjà les fabricants triés par nombre d'avions.
        // On prend simplement les 3 premiers pour le Top 3.
        const top3Manufacturers = aircraftData.slice(0, 3);

        // --- 3. MISE À JOUR DE L'INTERFACE UTILISATEUR (DOM) ---

        // KPI 1 : Vols Moyens par aéroport
        const flightsEl = document.getElementById('kpi-total-flights');
        if (flightsEl) {
            flightsEl.textContent = Math.round(avgFlightsPerAirport).toLocaleString('fr-FR');
            const titleEl = flightsEl.closest('.card').querySelector('.kpi-title');
            if(titleEl) titleEl.textContent = "Vols Moyens / Aéroport";
            updateTrend('kpi-total-trend', jsonData.totalTrend);
        }

        // KPI 2 : Retard Moyen par aéroport
        const delayEl = document.getElementById('kpi-avg-delay');
        if (delayEl) {
            delayEl.textContent = avgDelayPerAirport.toFixed(1) + " min";
            const titleEl = delayEl.closest('.card').querySelector('.kpi-title');
            if(titleEl) titleEl.textContent = "Retard Moyen / Aéroport";
            // Le troisième argument `true` inverse la couleur (une baisse est positive).
            updateTrend('kpi-delay-trend', jsonData.delayTrend, true);
        }

        // KPI 3 : Passagers Moyens / Mois
        const paxEl = document.getElementById('kpi-passengers');
        if (paxEl) {
            paxEl.textContent = avgMonthlyPassengersData.averageMonthlyPassengers.toLocaleString('fr-FR');
            const titleEl = paxEl.closest('.card').querySelector('.kpi-title');
            if(titleEl) titleEl.textContent = "Passagers Moyens / Mois";
            updateTrend('kpi-pax-trend', jsonData.paxTrend);
        }

        // KPI 4 : Top 3 des fabricants d'avions
        const statusEl = document.getElementById('kpi-status');
        if (statusEl) {
            const top3Text = top3Manufacturers.map(item => item.manufacturer_name).join(', ');
            statusEl.textContent = top3Text;
            statusEl.style.color = "#000000"; // Couleur de texte par défaut.

            const titleEl = statusEl.closest('.card').querySelector('.kpi-title');
            if(titleEl) titleEl.textContent = "Top 3 Fabricants";
        }
        
        // Mise à jour de l'heure de la dernière actualisation (si disponible).
        if(jsonData.lastUpdate) {
            const timeEl = document.getElementById('last-update-time');
            if (timeEl) timeEl.textContent = jsonData.lastUpdate;
        }
    })
    .catch(error => {
        // En cas d'échec d'une des API, on affiche un message d'erreur et des tirets.
        console.error("Erreur lors de l'initialisation des KPIs:", error);
        document.querySelectorAll('.metric-value').forEach(el => el.textContent = "-");
    });
}

/**
 * Met à jour l'indicateur de tendance (ex: +5% vs hier).
 * @param {string} elementId - L'ID de l'élément DOM qui contient la tendance.
 * @param {number} value - La valeur du pourcentage de changement.
 * @param {boolean} [inverseColors=false] - Si true, une valeur positive sera affichée en rouge (ex: augmentation des retards).
 */
function updateTrend(elementId, value, inverseColors = false) {
    const el = document.getElementById(elementId);
    if(!el) return;
    
    const isPositive = value >= 0;
    // Détermine la classe CSS (verte ou rouge) en fonction de la valeur et du contexte.
    let colorClass = inverseColors 
        ? (isPositive ? 'delta-neg' : 'delta-pos') 
        : (isPositive ? 'delta-pos' : 'delta-neg');
    
    const sign = isPositive ? '+' : '';
    el.innerHTML = ``;
}