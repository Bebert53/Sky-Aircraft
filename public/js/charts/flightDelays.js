/**
 * Ce script initialise une visualisation de données D3.js pour analyser les retards de vols.
 * Il crée un nuage de points (scatter plot) qui compare la ponctualité et le volume de vols
 * pour les compagnies aériennes ou les aéroports.
 * Le script est auto-contenu : il injecte ses propres styles, crée son interface
 * et gère les interactions de l'utilisateur.
 */
function initFlightDelayChart() {
    
    // --- 1. CONFIGURATION ET INITIALISATION ---
    const containerId = "#container-delay-viz";
    const container = d3.select(containerId);

    // Si le conteneur n'existe pas dans le DOM, on arrête l'exécution.
    if (container.empty()) return;

    // Définition des dimensions du graphique, en tenant compte des marges.
    const containerNode = container.node();
    const margin = {top: 20, right: 130, bottom: 50, left: 60}; 
    
    let width = containerNode.getBoundingClientRect().width - margin.left - margin.right;
    let height = containerNode.getBoundingClientRect().height - margin.top - margin.bottom;
    
    // Si la hauteur du conteneur est nulle, on applique une hauteur par défaut.
    if (height <= 0) { 
        height = 400; 
        d3.select(containerId).style("height", "460px"); 
    }

    // Vide le conteneur (pour le cas d'un rafraîchissement) et le marque comme chargé.
    container.html("").classed("loaded", true);

    // --- 2. INJECTION DES STYLES CSS ---
    // Injecte les styles nécessaires pour les contrôles et l'infobulle (tooltip)
    // si ce n'est pas déjà fait. Cela évite les dépendances externes.
    if (d3.select("#styles-airlines-chart").empty()) {
        d3.select("head").append("style").attr("id", "styles-airlines-chart").text(`
            .chart-controls { display: flex; gap: 10px; align-items: center; }
            .chart-btn { padding: 6px 16px; border: 1px solid #2563eb; background: white; color: #2563eb; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
            .chart-btn:hover { background: #eff6ff; }
            .chart-btn.active { background: #2563eb; color: white; }
            .chart-select { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 13px; color: #334155; cursor: pointer; outline: none; background: white; }
            #viz-tooltip { position: absolute; text-align: center; width: auto; padding: 10px; font-family: 'Inter', sans-serif; font-size: 12px; background: rgba(255, 255, 255, 0.98); border: 1px solid #cbd5e1; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; pointer-events: none; opacity: 0; z-index: 1000; transition: opacity 0.2s; }
        `);
    }

    // --- 3. CRÉATION DE L'INFO-BULLE (TOOLTIP) ---
    // Crée un seul élément div pour l'infobulle, qui sera réutilisé par le graphique.
    d3.select("#viz-tooltip").remove(); // Supprime l'ancien au cas où.
    const tooltip = d3.select("body").append("div").attr("id", "viz-tooltip");

    // --- 4. CRÉATION DE L'INTERFACE UTILISATEUR ---
    // Ajoute les boutons et le sélecteur de région dans l'en-tête de la carte.
    const cardHeader = d3.select(containerNode.parentNode).select(".chart-header");
    cardHeader.selectAll(".chart-controls").remove(); 

    const controls = cardHeader.append("div").attr("class", "chart-controls");

    const switchBtn = controls.append("button")
        .attr("class", "chart-btn")
        .text("Voir Aéroports"); 

    const select = controls.append("select").attr("class", "chart-select");
    select.append("option").text("Toutes les régions").attr("value", "all");

    // --- 5. INITIALISATION DE LA STRUCTURE SVG ---
    // Crée l'élément SVG principal et un groupe 'g' pour respecter les marges.
    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Groupes pour les axes X et Y.
    const xAxisG = svg.append("g").attr("transform", `translate(0, ${height})`);
    const yAxisG = svg.append("g");
    
    // Étiquettes pour les axes.
    const xLabel = svg.append("text").attr("text-anchor", "end").attr("x", width).attr("y", height + 40).style("fill", "#64748b").style("font-size", "12px");
    const yLabel = svg.append("text").attr("text-anchor", "end").attr("transform", "rotate(-90)").attr("y", -45).attr("x", 0).style("fill", "#64748b").style("font-size", "12px").text("Volume de vols");

    // --- 6. LOGIQUE DE LA VISUALISATION ---
    let currentMode = "airlines"; // Le mode initial est l'affichage par compagnie.

    /**
     * Fonction principale qui met à jour le graphique en fonction des données et du mode.
     * @param {Array<Object>} data - Données filtrées à afficher.
     * @param {string} mode - 'airlines' ou 'airports'.
     */
    function updateChart(data, mode) {
        // 1. Met à jour le sélecteur de région avec les régions disponibles dans les données.
        const allRegions = ["all", ...new Set(data.map(d => d.region))];
        select.selectAll("option").data(allRegions).join("option").attr("value", d => d).text(d => d === "all" ? "Toutes les régions" : d);

        let selectedRegion = select.property("value");
        if (!allRegions.includes(selectedRegion)) {
            selectedRegion = "all";
            select.property("value", "all");
        }
        
        // Filtre les données en fonction de la région sélectionnée.
        const filteredData = (selectedRegion === "all") ? data : data.filter(d => d.region === selectedRegion);

        // Crée une échelle de couleurs pour les régions
        const regions = allRegions.filter(r => r !== "all");
        const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(regions);

        // 2. Met à jour les échelles D3.
        // Échelle X (linéaire) pour le pourcentage de ponctualité.
        const x = d3.scaleLinear().domain([d3.min(filteredData, d => d.onTime) * 0.95, 100]).range([0, width]);
        // Échelle Y (logarithmique) pour le volume de vols, ce qui permet de mieux visualiser les ordres de grandeur.
        const y = d3.scaleLog().domain(d3.extent(filteredData, d => d.flights > 0 ? d.flights : 1)).range([height, 0]);

        // 3. Met à jour les axes avec des transitions fluides.
        xAxisG.transition().duration(500).call(d3.axisBottom(x).ticks(10).tickFormat(d => d.toFixed(0) + "%"));
        yAxisG.transition().duration(500).call(d3.axisLeft(y).ticks(5, d3.format("~s")));

        // 4. Met à jour les textes de l'interface (bouton, étiquettes d'axes).
        switchBtn.text(mode === 'airlines' ? "Voir Aéroports" : "Voir Compagnies");
        xLabel.text(mode === 'airlines' ? "Ponctualité à l'arrivée (%)" : "Ponctualité au départ (%)");
        yLabel.text("Volume de vols (échelle log)");

        // 5. Dessine les points du nuage en utilisant le "data-join pattern" de D3.
        svg.selectAll(".dot")
            .data(filteredData, d => d.name) // La clé 'd.name' est cruciale pour lier les données aux éléments.
            .join(
                // `enter`: pour les nouveaux points, on les crée avec un rayon de 0, puis on les fait grandir.
                enter => enter.append("circle").attr("class", "dot").attr("cx", d => x(d.onTime)).attr("cy", d => y(d.flights)).attr("r", 0).style("fill", d => colorScale(d.region)).style("opacity", 0.7).call(enter => enter.transition().duration(500).attr("r", 6)),
                // `update`: pour les points existants, on met à jour leur position.
                update => update.call(update => update.transition().duration(500).attr("cx", d => x(d.onTime)).attr("cy", d => y(d.flights))),
                // `exit`: pour les points qui ne sont plus dans les données, on les fait disparaître.
                exit => exit.call(exit => exit.transition().duration(500).attr("r", 0).remove())
            );

        // 6. Lie les événements pour l'infobulle (tooltip).
        svg.selectAll(".dot")
            .on("mouseover", function(event, d) {
                tooltip.style("opacity", 1);
                d3.select(this).style("stroke", "black").style("stroke-width", 2);
            })
            .on("mousemove", function(event, d) {
                tooltip.html(`<strong>${d.name}</strong><br>Région: ${d.region}<br>Ponctualité: ${d.onTime.toFixed(2)}%<br>Vols: ${d.flights.toLocaleString('fr-FR')}`)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function() {
                tooltip.style("opacity", 0);
                d3.select(this).style("stroke", "none");
            });

        // 7. Attache l'événement au sélecteur de région.
        select.on("change", () => {
            updateChart(data, mode); // Rappelle la fonction avec les données d'origine pour refiltrer.
        });
        
        // 8. Légende
        svg.selectAll(".legend-container").remove();
        if (selectedRegion === 'all') {
            const legendContainer = svg.append("g")
                .attr("class", "legend-container")
                .attr("transform", `translate(${width + 10}, 0)`);

            const legend = legendContainer.selectAll(".legend")
                .data(colorScale.domain())
                .enter().append("g")
                .attr("class", "legend")
                .attr("transform", (d, i) => `translate(0, ${i * 20})`);

            legend.append("rect")
                .attr("x", 0)
                .attr("width", 14)
                .attr("height", 14)
                .style("fill", colorScale);

            legend.append("text")
                .attr("x", 20)
                .attr("y", 7)
                .attr("dy", ".35em")
                .style("text-anchor", "start")
                .style("font-size", "12px")
                .text(d => d);
        }
    }

/**
     * Charge les données depuis l'API appropriée et lance la mise à jour du graphique.
     * @param {string} mode - Le mode de visualisation ('airlines' ou 'airports').
     */
    function loadAndDisplay(mode) {
        const url = mode === 'airlines' ? '/api/delays/airlines' : '/api/delays/airports';
        
        d3.json(url).then(function(data) {
            // Assure que les données numériques sont bien des nombres et normalise les noms de clés.
            const processedData = data.map(d => {
                return { 
                    ...d, 
                    // Normalisation : on cherche 'name' (compagnie) OU 'airport_name' (votre table DB)
                    name: d.name || d.airport_name, 
                    
                    // Normalisation : 'onTime' OU 'on_time_departure'
                    onTime: +(d.onTime !== undefined ? d.onTime : d.on_time_departure), 
                    
                    // Normalisation : 'flights' OU 'total_flights'
                    flights: +(d.flights !== undefined ? d.flights : d.total_flights),
                    
                    region: d.region || 'Unknown Region'
                };
            }).filter(d => d.name && d.name.toLowerCase() !== "unknown"); // Le filtre fonctionnera maintenant car d.name est peuplé

            updateChart(processedData, mode);
        }).catch(err => {
            console.error("Erreur de chargement des données: ", err);
            container.html(`<div style="color:red; text-align:center;">Erreur chargement des données depuis ${url}</div>`);
        });
    }

    // --- 7. GESTION DES ÉVÉNEMENTS INITIAUX ---
    // Gère le clic sur le bouton pour changer de mode.
    switchBtn.on("click", function() {
        currentMode = (currentMode === 'airlines') ? 'airports' : 'airlines';
        loadAndDisplay(currentMode);
    });

    // Charge les données initiales (compagnies aériennes).
    loadAndDisplay('airlines');
}