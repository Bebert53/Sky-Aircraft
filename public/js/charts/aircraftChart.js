function initAircraftChart(filters = {}) {
    const ctxContainer = document.getElementById('container-aircraft-chart');
    if (!ctxContainer) return;

    let API_URL = '/api/aircraft';
    const params = new URLSearchParams();

    // Ajouter d'autres filtres ici au fur et à mesure qu'ils sont implémentés (ex: année, type)
    // if (filters.year) {
    //     params.append('year', filters.year);
    // }

    if (params.toString()) {
        API_URL += `?${params.toString()}`;
    }

    const handleData = (rawData) => {
        console.log('[aircraftChart] Raw data received:', rawData);

        // Normalize common column names (case-insensitive)
        const data = rawData.map(row => {
            const keys = Object.keys(row);
            const find = (names) => {
                for (const n of names) {
                    if (row[n] !== undefined) return row[n];
                    const k = keys.find(k => k.toLowerCase() === n.toLowerCase());
                    if (k) return row[k];
                }
                return undefined;
            };

            const label = find(['manufacturer_name', 'type', 'aircraft', 'name', 'category', 'label']) || '';
            const count = find(['aircraft_count', 'count', 'count_total', 'value', 'total', 'v']) || 0;
            return { type: label, count: +count };
        });

        // Applique le filtre topN si spécifié (client-side car l'API ne le gère pas)
        let filteredData = data;
        if (filters.topN && filters.topN !== 'all') {
            const num = parseInt(filters.topN);
            if (!isNaN(num) && num > 0) {
                filteredData = data.sort((a, b) => b.count - a.count).slice(0, num);
            }
        }

        console.log('[aircraftChart] Processed data:', filteredData);

        ctxContainer.innerHTML = '<canvas id="aircraftCanvas"></canvas>';
        ctxContainer.classList.add('loaded');

        const labels = filteredData.map(d => d.type);
        const values = filteredData.map(d => d.count);

        console.log('[aircraftChart] Labels for chart:', labels);
        console.log('[aircraftChart] Values for chart:', values);

        try {
            new Chart(document.getElementById('aircraftCanvas'), {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: ['#4F81BC', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646', '#D98282'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                boxWidth: 12,
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
            console.log('[aircraftChart] Chart created successfully.');
        } catch (e) {
            console.error('[aircraftChart] Error creating chart:', e);
        }
    };

    // Fetch only from API JSON (SQLite-backed server). No CSV fallback.
    fetch(API_URL)
        .then(r => {
            if (!r.ok) {
                console.error(`[aircraftChart] API fetch failed with status: ${r.status}`);
                throw new Error('API not available');
            }
            console.log('[aircraftChart] API fetch successful.');
            return r.json();
        })
        .then(json => {
            console.log('[aircraftChart] JSON parsed:', json);
            handleData(Array.isArray(json) ? json : []);
        })
        .catch(err => {
            console.error('[aircraftChart] API aircraft error:', err);
            ctxContainer.innerHTML = '<p style="color:red">Erreur chargement données (API indisponible)</p>';
        });
}