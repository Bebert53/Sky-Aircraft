/**
 * Initialise le graphique du trafic aéroportuaire (graphique à barres).
 * Ce module est responsable de l'affichage du trafic de passagers par pays,
 * avec un filtre interactif par année. Il est auto-contenu et injecte ses propres styles.
 */
function initAirportChart() {
    // Cible le conteneur HTML principal pour le graphique.
    const containerId = 'container-airport-chart';
    const ctxContainer = document.getElementById(containerId);
    if (!ctxContainer) return; // Arrête si le conteneur n'est pas trouvé.

    // 1. Injection des styles CSS pour ce composant de graphique.
    // Cela rend le graphique indépendant d'un fichier CSS externe.
    injectChartStyles();

    // 2. Récupération des données depuis l'API.
    const API_URL = '/api/traffic';
    
    // Affiche un état de chargement pendant que les données sont récupérées.
    ctxContainer.innerHTML = '<div class="chart-loading">Chargement des données...</div>';

    fetch(API_URL)
        .then(r => {
            if (!r.ok) throw new Error('API indisponible');
            return r.json();
        })
        .then(data => {
            // Extrait les années uniques des données et les trie par ordre décroissant.
            const years = [...new Set(data.map(d => d.year))].sort((a, b) => b - a);
            
            // Dictionnaire pour mapper les codes pays ISO (2 lettres) à leurs noms en français.
            const countryNames = {
                'AT': 'Autriche', 'BA': 'Bosnie', 'BE': 'Belgique', 'BG': 'Bulgarie',
                'CH': 'Suisse', 'CY': 'Chypre', 'CZ': 'Rép. Tchèque', 'DE': 'Allemagne',
                'DK': 'Danemark', 'ES': 'Espagne', 'EE': 'Estonie', 'FR': 'France',
                'GB': 'Royaume-Uni', 'GR': 'Grèce', 'HR': 'Croatie', 'HU': 'Hongrie',
                'IE': 'Irlande', 'IS': 'Islande', 'IT': 'Italie', 'LT': 'Lituanie',
                'LU': 'Luxembourg', 'LV': 'Lettonie', 'MT': 'Malte', 'NL': 'Pays-Bas',
                'NO': 'Norvège', 'PL': 'Pologne', 'PT': 'Portugal', 'RO': 'Roumanie',
                'SE': 'Suède', 'SI': 'Slovénie', 'SK': 'Slovaquie', 'TR': 'Turquie'
            };

            // 3. Construction de l'interface utilisateur du graphique.
            setupAirportInterface(ctxContainer, years, data, countryNames);
        })
        .catch(err => {
            // En cas d'erreur, affiche un message clair dans le conteneur.
            console.error('Erreur API trafic:', err);
            ctxContainer.innerHTML = `
                <div class="chart-error">
                    <p>⚠️ Impossible de charger les données de trafic.</p>
                </div>`;
        });
}

/**
 * Construit l'interface du graphique, y compris le titre, le sous-titre,
 * le sélecteur d'année et le canevas pour le graphique.
 * @param {HTMLElement} container - L'élément DOM qui contiendra le graphique.
 * @param {Array<number>} years - La liste des années disponibles pour le filtre.
 * @param {Array<Object>} data - L'ensemble des données de trafic.
 * @param {Object} countryNames - Le dictionnaire de mappage des codes pays.
 */
function setupAirportInterface(container, years, data, countryNames) {
    // Vide le conteneur (pour enlever le message de chargement).
    container.innerHTML = '';
    container.className = 'airport-chart-wrapper';
    
    // --- Création de l'en-tête (Titre + Filtre) ---
    const header = document.createElement('div');
    header.className = 'chart-header';

    // Section titre et sous-titre.
    const titleDiv = document.createElement('div');
    titleDiv.innerHTML = `
        <h3 class="chart-title">Trafic Aérien par Pays</h3>
        <span class="chart-subtitle">Top 15 des destinations en Europe</span>
    `;

    // Section pour les contrôles (le sélecteur d'année).
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'chart-controls';

    const yearLabel = document.createElement('label');
    yearLabel.textContent = 'Année: ';
    yearLabel.className = 'chart-label';

    const yearSelect = document.createElement('select');
    yearSelect.className = 'chart-select-modern';
    
    // Remplit le sélecteur avec les années disponibles.
    const maxYear = Math.max(...years);
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === maxYear) opt.selected = true; // Sélectionne l'année la plus récente par défaut.
        yearSelect.appendChild(opt);
    });

    // Assemble l'en-tête.
    header.appendChild(titleDiv);
    controlsDiv.appendChild(yearLabel);
    controlsDiv.appendChild(yearSelect);
    header.appendChild(controlsDiv);
    
    // --- Création du conteneur pour le canevas ---
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'chart-canvas-container';
    canvasContainer.innerHTML = '<canvas id="airportCanvas"></canvas>';
    
    // Ajoute les éléments créés au conteneur principal.
    container.appendChild(header);
    container.appendChild(canvasContainer);
    
    // --- Logique de mise à jour ---
    // Fonction qui sera appelée à chaque changement du sélecteur.
    const updateDisplay = () => {
        const selectedYear = Number(yearSelect.value);
        updateChart(data, countryNames, { year: selectedYear });
    };
    
    yearSelect.addEventListener('change', updateDisplay);
    
    // Premier affichage du graphique avec l'année par défaut.
    updateDisplay();
}

// Variable globale pour stocker l'instance du graphique et pouvoir la détruire/recréer.
let airportChartInstance = null;

/**
 * Met à jour (ou crée) le graphique Chart.js avec les données filtrées pour une année donnée.
 * @param {Array<Object>} data - L'ensemble des données de trafic.
 * @param {Object} countryNames - Le dictionnaire de mappage des codes pays.
 * @param {Object} filters - Les filtres à appliquer (ex: { year: 2024 }).
 */
function updateChart(data, countryNames, filters) {
    // 1. Filtre les données pour l'année sélectionnée et nettoie les codes pays non pertinents.
    let filtered = data.filter(d => 
        d.year === filters.year && 
        !['EU27_2020', 'EU28', 'EEA', 'EFTA'].some(k => d.country_code.includes(k)) &&
        d.country_code.length === 2 // Ne garde que les codes pays à 2 lettres.
    );

    // 2. Agrège les données par pays.
    const countryData = {};
    filtered.forEach(row => {
        const code = row.country_code;
        const passengers = row.passenger_count || 0;
        if (code && passengers > 0) {
            countryData[code] = passengers;
        }
    });

    // 3. Trie les données par nombre de passagers et ne conserve que le Top 15.
    const chartData = Object.entries(countryData)
        .map(([code, passengers]) => ({
            label: countryNames[code] || code, // Utilise le nom complet ou le code si non trouvé.
            passengers: passengers
        }))
        .sort((a, b) => b.passengers - a.passengers)
        .slice(0, 15);

    // --- Configuration et rendu de Chart.js ---
    const ctx = document.getElementById('airportCanvas');
    if (!ctx) return;

    // Détruit l'ancienne instance du graphique si elle existe pour éviter les superpositions.
    if (airportChartInstance) airportChartInstance.destroy();

    // Génère un dégradé de couleurs dynamique pour les barres.
    const backgroundColors = ['#4F81BC', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646', '#D98282', '#5F497A', '#77933C', '#2A556A', '#D98282', '#C0504D', '#4F81BC', '#9BBB59', '#8064A2'];

    airportChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        indexAxis: 'x', // Affiche les barres verticalement.
        data: {
            labels: chartData.map(d => d.label),
            datasets: [{
                label: 'Passagers',
                data: chartData.map(d => d.passengers),
                backgroundColor: backgroundColors,
                borderRadius: 6,
                barPercentage: 0.7,
                categoryPercentage: 0.8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false }, // Cache la légende du dataset.
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.9)',
                    padding: 12,
                    titleFont: { size: 14, weight: 'bold', family: "'Inter', sans-serif" },
                    bodyFont: { size: 13, family: "'Inter', sans-serif" },
                    cornerRadius: 6,
                    displayColors: false,
                    callbacks: {
                        // Personnalise le contenu de l'infobulle.
                        label: (ctx) => ` ${ctx.raw.toLocaleString('fr-FR')} passagers`,
                        afterLabel: (ctx) => ` ${(ctx.raw / 1000000).toFixed(1)} Millions`
                    }
                }
            },
            scales: { 
                x: { 
                    grid: { color: '#f1f5f9', drawBorder: false },
                    ticks: {
                        font: { size: 12, weight: '600' },
                        color: '#334155',
                        autoSkip: false,
                        maxRotation: 40,
                        minRotation: 20
                    }
                },
                y: { 
                    grid: { display: true, color: '#e2e8f0' },
                    ticks: { 
                        // Formate les graduations de l'axe Y en millions (ex: '10M').
                        callback: (val) => (val / 1000000).toFixed(0) + 'M',
                        font: { size: 11 },
                        color: '#64748b'
                    }
                }
            },
            animation: { duration: 600 }
        }
    });
}

/**
 * Injecte une feuille de style CSS dans le <head> du document.
 * Cela permet au composant d'être stylisé de manière autonome
 * sans dépendre d'un fichier CSS externe.
 */
function injectChartStyles() {
    const styleId = 'airport-chart-styles';
    if (document.getElementById(styleId)) return; // N'injecte les styles qu'une seule fois.

    const css = `
        .airport-chart-wrapper {
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            padding: 24px;
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            border: 1px solid #e2e8f0;
            max-width: 100%;
        }
        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            flex-wrap: wrap;
            gap: 16px;
        }
        .chart-title {
            margin: 0;
            font-size: 1.25rem;
            color: #0f172a;
            font-weight: 700;
        }
        .chart-subtitle {
            font-size: 0.875rem;
            color: #64748b;
            margin-top: 4px;
            display: block;
        }
        .chart-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
        }
        .chart-label {
            font-size: 0.95rem;
            font-weight: 600;
            color: #475569;
        }
        .chart-select-modern {
            padding: 8px 32px 8px 12px;
            font-size: 0.95rem;
            font-weight: 600;
            color: #4f46e5;
            background-color: #eef2ff;
            border: 1px solid #c7d2fe;
            border-radius: 8px;
            cursor: pointer;
            outline: none;
            appearance: none;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234f46e5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 8px center;
            background-size: 16px;
            transition: all 0.2s;
        }
        .chart-select-modern:hover {
            background-color: #e0e7ff;
            border-color: #818cf8;
        }
        .chart-select-modern:focus {
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
        }
        .chart-canvas-container {
            position: relative;
            height: 450px;
            width: 100%;
        }
        .chart-loading, .chart-error {
            text-align: center;
            padding: 40px;
            color: #64748b;
            font-weight: 500;
        }
        .chart-error { color: #ef4444; }
    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}