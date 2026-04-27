// Simple historical viewer: fetch list of CSVs and render selected file on a Leaflet map
const SOCKET_URL = "http://localhost:8000";
const API_BASE = '/api/historical';

let map = L.map('map').setView([52, 5], 5);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 10, minZoom: 4
}).addTo(map);
const layerGroup = L.layerGroup().addTo(map);
const tooltip = document.getElementById('tooltip');

// STATE for historical renderer (match live behavior)
let aircraftMarkers = new Map();
let countries = new Set();
let uniqueToday = new Set();
let lastDisplayedBatch = [];
let isProcessing = false;
// per-aircraft historical index: icao24 -> [{ts_ms, ts_iso, lat, lon, ...}, ...]
let aircraftIndex = new Map();
let currentTrack = null; // array of points for selected aircraft
let currentTrackLayer = null; // polyline
let currentTrackMarker = null; // moving marker
let playTimer = null;
let currentTrackIndex = 0;

const AIRLINE_PREFIXES = {
  'AF': 'Air France', 'LH': 'Lufthansa', 'BA': 'British Airways',
  'KL': 'KLM', 'RYR': 'Ryanair', 'EZY': 'EasyJet',
  'AAL': 'American Airlines', 'DAL': 'Delta Airlines', 'UAE': 'Emirates'
};

function showLoader(){ document.getElementById('loaderOverlay').classList.remove('hidden'); }
function hideLoader(){ document.getElementById('loaderOverlay').classList.add('hidden'); }

function kmhFromMs(ms){return Math.round((Number(ms)||0)*3.6)}
function speedClass(ms){ const kmh = kmhFromMs(ms); if (kmh>=700) return 'speed-high'; if (kmh>=300) return 'speed-mid'; return 'speed-low'; }
function formatCallsign(cs){ return cs && cs.trim() ? cs.trim() : '—'; }

function showTooltip(e,d){ const {originalEvent} = e; const x = originalEvent.clientX, y = originalEvent.clientY; tooltip.classList.remove('hidden'); tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px'; const alt = Math.round(Number(d.geo_alt_m||d.baro_alt_m||0)); tooltip.innerHTML = `<strong>${formatCallsign(d.callsign)}</strong><br/>${d.origin_country||'—'}<br/>Alt: ${alt} m<br/>Vitesse: ${kmhFromMs(d.spd_ms)} km/h<br/>Cap: ${Math.round(Number(d.hdg_deg||0))}°<br/>Sol: ${d.on_ground? 'oui':'non'}<br/>ICAO24: ${d.icao24||'—'}`; }
function hideTooltip(){ tooltip.classList.add('hidden'); }

function upsertMarker(mapp, markersMap, d){
  const key = d.icao24 || d.callsign || (d.lat+"_"+d.lon);
  const speed_class = speedClass(d.spd_ms);
  const lat = Number(d.lat), lon = Number(d.lon);
  const heading = Math.round(Number(d.hdg_deg||0));
  if (!isFinite(lat) || !isFinite(lon)) return;

  let m = markersMap.get(key);
  const iconHtml = `<i class="fa-solid fa-plane ${speed_class}" style="transform: rotate(${heading}deg);"></i>`;
  const iconNew = L.divIcon({ className: 'custom-plane-icon', html: iconHtml, iconSize:[24,24], iconAnchor:[12,12] });

  if (!m){
    m = L.marker([lat,lon], {icon: iconNew})
      .on('mousemove', (e)=>showTooltip(e,d))
      .on('mouseout', hideTooltip)
      .addTo(layerGroup);
    markersMap.set(key,m);
  } else {
    m.setLatLng([lat,lon]);
    const el = m.getElement(); if (el) el.innerHTML = iconHtml;
  }
}

function updateKPIs(nowCount){
  const el = document.getElementById('kpiNow');
  if (el) el.textContent = nowCount.toLocaleString('fr-FR');
  const lu = document.getElementById('lastUpdate');
  if (lu) lu.textContent = 'Chargé: ' + new Date().toLocaleTimeString();
}

function applyFilters(d){
    const showGround = document.getElementById('showGround') ? document.getElementById('showGround').checked : true;
    const minAlt = Number(document.getElementById('minAlt').value || 0);
    const country = document.getElementById('countrySelect').value;
    const minSpeed = Number(document.getElementById('minSpeed').value || 0);
    const airline = document.getElementById('airlineFilter').value;

    const alt = Number(d.geo_alt_m ?? d.baro_alt_m ?? 0);
    const speed = kmhFromMs(d.spd_ms);

    if (!showGround && d.on_ground) return false;
    if (alt < minAlt) return false;
    if (country && d.origin_country !== country) return false;
    if (speed < minSpeed) return false;
    if (airline && d.callsign && !d.callsign.startsWith(airline)) return false;

    return true;
}

function refreshCountrySelect(){
  const select = document.getElementById('countrySelect');
  if (!select) return;
  const currentValue = select.value;
  const current = new Set();
  for (const c of countries) current.add(c);
  if (currentValue && currentValue !== "") current.add(currentValue);
  while (select.options.length > 1) select.remove(1);
  [...current].sort((a,b)=>a.localeCompare(b)).forEach(c => {
    const opt = document.createElement('option'); opt.value = c; opt.textContent = c; select.appendChild(opt);
  });
  select.value = currentValue;
}

function initAirlineFilter(){
    const select = document.getElementById('airlineFilter');
    if (!select) return;
    for (const prefix in AIRLINE_PREFIXES){
        const opt = document.createElement('option'); opt.value = prefix; opt.textContent = `${AIRLINE_PREFIXES[prefix]} (${prefix})`; select.appendChild(opt);
    }
}

function processBatchAndRender(dataArray){
    if (!Array.isArray(dataArray)) return;
    const isNewServerBatch = true; // historical batch treated as new

    countries.clear();
    let nowCount = 0;

    // remove old markers
    for (const [k,m] of aircraftMarkers){ layerGroup.removeLayer(m); }
    aircraftMarkers.clear();

    for (const d of dataArray){
      if (isNewServerBatch){ countries.add(d.origin_country || ''); if (d.icao24) uniqueToday.add(d.icao24); }
      if (applyFilters(d)){
        upsertMarker(map, aircraftMarkers, d);
        nowCount++;
      }
    }

    refreshCountrySelect();
    updateKPIs(nowCount);
}

function buildAircraftIndex(dataArray){
  aircraftIndex.clear();
  for (const d of dataArray){
    const key = d.icao24 || d.callsign || (d.lat+"_"+d.lon);
    const ts_ms = Date.parse(d.ts_iso) || NaN;
    const entry = { ts_ms, ts_iso: d.ts_iso, lat: Number(d.lat), lon: Number(d.lon), callsign: d.callsign, origin_country: d.origin_country, spd_ms: d.spd_ms, hdg_deg: d.hdg_deg, on_ground: d.on_ground };
    if (!aircraftIndex.has(key)) aircraftIndex.set(key, []);
    aircraftIndex.get(key).push(entry);
  }
  // sort each track by timestamp
  for (const [k, arr] of aircraftIndex) arr.sort((a,b)=> (a.ts_ms||0) - (b.ts_ms||0));
}

function populateAircraftSelect(){
  const sel = document.getElementById('aircraftSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">- Aucun -</option>';
  const items = [];
  for (const [k, arr] of aircraftIndex){
    const label = (arr[0] && arr[0].callsign) ? `${arr[0].callsign} — ${k}` : k;
    items.push({k,label,count:arr.length,firstTs: arr[0] && arr[0].ts_ms});
  }
  items.sort((a,b)=> (b.count - a.count) || (a.firstTs - b.firstTs));
  for (const it of items){ const opt = document.createElement('option'); opt.value = it.k; opt.textContent = `${it.label} (${it.count})`; sel.appendChild(opt); }
  if (prev) sel.value = prev;
}

function clearCurrentTrack(){
  if (currentTrackLayer){ layerGroup.removeLayer(currentTrackLayer); currentTrackLayer = null; }
  if (currentTrackMarker){ layerGroup.removeLayer(currentTrackMarker); currentTrackMarker = null; }
  currentTrack = null; currentTrackIndex = 0; document.getElementById('timeLabel').textContent = '—'; document.getElementById('timeSlider').max = 0; document.getElementById('timeSlider').value = 0; stopPlay();
}

function drawTrackFor(key){
  clearCurrentTrack();
  const arr = aircraftIndex.get(key);
  if (!arr || arr.length === 0) return;
  currentTrack = arr;
  const latlngs = arr.map(p=>[p.lat,p.lon]);
  currentTrackLayer = L.polyline(latlngs, {color:'#1f77b4', weight:3, opacity:0.9}).addTo(layerGroup);
  // marker at first point
  const first = arr[0];
  const markerIcon = L.divIcon({ className: 'custom-plane-icon', html: `<i class="fa-solid fa-plane" style="transform: rotate(${Math.round(first.hdg_deg||0)}deg);"></i>`, iconSize:[24,24], iconAnchor:[12,12] });
  currentTrackMarker = L.marker([first.lat, first.lon], {icon: markerIcon}).addTo(layerGroup);
  // setup slider
  const slider = document.getElementById('timeSlider');
  slider.min = 0; slider.max = Math.max(0, arr.length-1); slider.value = 0;
  currentTrackIndex = 0;
  updateTimeLabel();
  // fit
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds.pad(0.2));
}

function updateTimeLabel(){
  if (!currentTrack) { document.getElementById('timeLabel').textContent = '—'; return; }
  const p = currentTrack[currentTrackIndex];
  if (!p) return; document.getElementById('timeLabel').textContent = new Date(p.ts_ms).toLocaleString(); document.getElementById('timeSlider').value = currentTrackIndex;
}

function seekToIndex(i){
  if (!currentTrack) return; i = Math.max(0, Math.min(currentTrack.length-1, i)); currentTrackIndex = i; const p = currentTrack[currentTrackIndex];
  if (!p) return; if (currentTrackMarker) currentTrackMarker.setLatLng([p.lat,p.lon]); updateTimeLabel();
}

function startPlay(intervalMs=500){
  if (!currentTrack || currentTrack.length <= 1) return; stopPlay();
  playTimer = setInterval(()=>{
    if (currentTrackIndex >= currentTrack.length-1){ stopPlay(); return; }
    currentTrackIndex++; seekToIndex(currentTrackIndex);
  }, intervalMs);
  document.getElementById('playBtn').textContent = '⏸ Pause';
}

function stopPlay(){ if (playTimer){ clearInterval(playTimer); playTimer = null; } const btn = document.getElementById('playBtn'); if (btn) btn.textContent = '▶️ Lecture'; }


async function fetchFiles(){
  const sel = document.getElementById('histFileSelect');
  sel.innerHTML = '<option>Chargement...</option>';
  try{
    // Use DB-backed batches endpoint
    const res = await fetch(`${SOCKET_URL}/api/historical/batches`);
    if (!res.ok) throw new Error('API batches error');
    const batches = await res.json();
    sel.innerHTML = '';
    // batches: [{batch_key, ts_unix, count, label}, ...]
    batches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.batch_key;
      // Use label (HH:mm format) and count from server
      opt.textContent = `${b.label} — ${b.count} avions`;
      sel.appendChild(opt);
    });
  }catch(e){ sel.innerHTML = '<option>Erreur</option>'; console.error(e); }
}

function parseCsvData(csvText){
  // historical CSV parsing removed: historical data must be loaded from API (/api/historical/batch/:batchKey)
  return [];
}

async function loadAndRender(batchKey){
  showLoader();
  try{
    const res = await fetch(`${SOCKET_URL}/api/historical/batch/${encodeURIComponent(batchKey)}`);
    if (!res.ok) throw new Error('Failed to fetch batch ' + batchKey);
    const arr = await res.json();
    // arr is already array of objects
    lastDisplayedBatch = arr;
    processBatchAndRender(lastDisplayedBatch);
    document.getElementById('lastUpdate').textContent = 'Chargé: '+ (arr[0] && arr[0].ts_iso ? arr[0].ts_iso : batchKey);
  }catch(e){ console.error(e); alert('Erreur de chargement'); }
  hideLoader();
}

document.getElementById('loadHistBtn').addEventListener('click', ()=>{
  const s = document.getElementById('histFileSelect'); if (!s.value) return; loadAndRender(s.value);
});

// Init
fetchFiles();

// Fit bounds helper
document.getElementById('lastUpdate').textContent = 'Sélectionner un instant puis Cliquer "Charger"';
// Initialize filters and events to behave like live page
initAirlineFilter();
document.getElementById('countrySelect').addEventListener('change', ()=> processBatchAndRender(lastDisplayedBatch));
document.getElementById('showGround').addEventListener('change', ()=> processBatchAndRender(lastDisplayedBatch));
document.getElementById('minAlt').addEventListener('change', ()=> processBatchAndRender(lastDisplayedBatch));
document.getElementById('minSpeed').addEventListener('change', ()=> processBatchAndRender(lastDisplayedBatch));
document.getElementById('airlineFilter').addEventListener('change', ()=> processBatchAndRender(lastDisplayedBatch));
document.getElementById('fitBtn').addEventListener('click', ()=> map.fitBounds([[36.0, -11.0],[65.0,25.0]]));
