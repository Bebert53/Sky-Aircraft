let currentAircraftFilters = { topN: "5" }; // Stocke les filtres actuellement appliqués pour le graphique des aéronefs

/**
 * Ce script est le point d'entrée principal pour l'initialisation du tableau de bord.
 * Il s'assure que le DOM est entièrement chargé avant d'exécuter les scripts
 * d'initialisation pour chaque widget (KPIs, graphiques).
 */
document.addEventListener('DOMContentLoaded', () => {
    
    // Initialise chaque widget du tableau de bord de manière sécurisée.
    // L'utilisation de try/catch garantit que si un widget échoue à s'initialiser,
    // cela n'empêchera pas les autres de se charger.

    // Initialisation des filtres pour le graphique des aéronefs (Top N)
    const topNFilterSelect = document.getElementById('aircraft-topn-filter');
    if (topNFilterSelect) {
        topNFilterSelect.value = currentAircraftFilters.topN; // Définit la sélection initiale
        topNFilterSelect.addEventListener('change', (event) => {
            currentAircraftFilters.topN = event.target.value;
            // Réinitialise le graphique des aéronefs avec les nouveaux filtres
            try { 
                if(typeof initAircraftChart === 'function') {
                    initAircraftChart(currentAircraftFilters); 
                }
            } catch(e) { 
                console.error("Erreur lors de l'initialisation du graphique de flotte avec filtres:", e); 
            }
        });
    }
    
    // 1. Initialisation des indicateurs clés de performance (KPIs).
    try { 
        if(typeof initKpiWidget === 'function') {
            initKpiWidget(); 
        }
    } catch(e) { 
        console.error("Erreur lors de l'initialisation des KPIs:", e); 
    }

    // 2. Initialisation du graphique du trafic par aéroport (barres).
    try { 
        if(typeof initAirportChart === 'function') {
            initAirportChart(); 
        }
    } catch(e) { 
        console.error("Erreur lors de l'initialisation du graphique de trafic:", e); 
    }

    // 3. Initialisation du graphique de répartition de la flotte (donut).
    try { 
        if(typeof initAircraftChart === 'function') {
            initAircraftChart(currentAircraftFilters); 
        }
    } catch(e) { 
        console.error("Erreur lors de l'initialisation du graphique de flotte:", e); 
    }

    // 4. Initialisation de la visualisation des retards (D3.js scatter plot).
    try { 
        if(typeof initFlightDelayChart === 'function') {
            initFlightDelayChart(); 
        }
    } catch(e) { 
        console.error("Erreur lors de l'initialisation de la visualisation des retards:", e); 
    }
});

/**
 * Fonction appelée par le bouton "Actualiser" de l'interface.
 * Relance l'initialisation de tous les widgets pour rafraîchir leurs données.
 */
function refreshData() {
    // Pour l'instant, cette fonction relance simplement les fonctions d'initialisation.
    // Dans une application plus complexe, on pourrait ici ne re-déclencher que
    // les `fetch` de données sans reconstruire tout le DOM des graphiques.
    initKpiWidget();
    initAirportChart();
    initAircraftChart(currentAircraftFilters); // Passe les filtres actuels
    initFlightDelayChart();
}
