const TILE_URL = 'https://api.maptiler.com/maps/topo-v4/256/{z}/{x}/{y}.png?key=fyz6kNYuQtvSwaBwX6CJ';
const TILE_OPTIONS = { attribution: '&copy; MapTiler &copy; OpenStreetMap', maxZoom: 19 };
const DEFAULT_CENTER = [54.74622, 25.21294];
const DEFAULT_ZOOM = 13;
const LINE_WEIGHT = 6;
const LINE_WEIGHT_ACTIVE = 10;

// Sukuria žemėlapį su platesne paspaudimo zona linijoms (lengviau paliesti telefone)
function createMap(id) {
    const m = L.map(id, {
        zoomControl: false,
        renderer: L.canvas({ tolerance: 14 })
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    return m;
}

// 1. Įrašymo žemėlapis
const map = createMap('map');

// Buvusių maršrutų žemėlapis (sukuriamas pirmą kartą atidarius skiltį)
let mapHistory = null;
const historyPolylineMap = new Map();

const colors = ['#2563eb', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6'];
let selectedColor = colors[0];

function loadLines() {
    try {
        const data = JSON.parse(localStorage.getItem('myNumberedLines'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}
let linesData = loadLines();
const polylineMap = new Map();

let watchId = null, timerInterval = null, startTime = null, totalElapsed = 0;
let userMarker = null, accuracyCircle = null, isGpsRecording = false;
let currentLineData = null, currentPolyline = null;
let lastAltitude = null;

const colorPalette = document.getElementById('colorPalette');
const customColorInput = document.getElementById('customColor');
const lineNameInput = document.getElementById('lineName');
const lineSelect = document.getElementById('lineSelect');
const deleteSelect = document.getElementById('deleteSelect');
const gpsDrawBtn = document.getElementById('gpsDrawBtn');
const statsPanel = document.getElementById('statsPanel');
const historyEmpty = document.getElementById('history-empty');

// Ekranėlio elementai
const infoCard = document.getElementById('info-card');
const cardTitle = document.getElementById('card-title');
const cardDot = document.getElementById('card-dot');
const cardDuration = document.getElementById('card-duration');
const cardDistance = document.getElementById('card-distance');
const cardSpeed = document.getElementById('card-speed');
const cardElevation = document.getElementById('card-elevation');
const cardDate = document.getElementById('card-date');
const closeBtn = document.getElementById('close-btn');

// ---------- Ekranėlis iš apačios + pažymėto maršruto paryškinimas ----------
let selectedPoly = null;

function clearSelection() {
    if (selectedPoly) {
        selectedPoly.setStyle({ weight: LINE_WEIGHT, opacity: 0.85 });
        selectedPoly = null;
    }
}

function closeCard() {
    infoCard.classList.add('hidden');
    clearSelection();
}

closeBtn.onclick = closeCard;
map.on('click', closeCard);

function showRouteCard(line, poly) {
    clearSelection();
    if (poly) {
        selectedPoly = poly;
        poly.setStyle({ weight: LINE_WEIGHT_ACTIVE, opacity: 1 });
        poly.bringToFront();
    }

    cardTitle.textContent = `#${line.id}: ${line.name}`;
    cardDot.style.background = line.color;
    cardDuration.textContent = formatTime(line.duration || 0);
    cardDistance.textContent = formatDist(line.distance || 0);

    const km = (line.distance || 0) / 1000;
    const hrs = (line.duration || 0) / 3600;
    cardSpeed.textContent = hrs > 0 && km > 0 ? (km / hrs).toFixed(1) + ' km/h' : '0.0 km/h';
    cardElevation.textContent = `${Math.round(line.elevationGain || 0)} m`;
    cardDate.textContent = line.date || '-';

    infoCard.classList.remove('hidden');
}

// ---------- Skilčių perjungimas ----------
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach(item => {
    item.onclick = () => {
        const tabName = item.getAttribute('data-tab');

        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        tabContents.forEach(tab => tab.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');

        closeCard();

        if (tabName === 'record') {
            setTimeout(() => map.invalidateSize(), 50);
        } else if (tabName === 'history') {
            if (!mapHistory) {
                // Pirmą kartą: pradedame nuo to paties taško ir mastelio kaip įrašymo žemėlapyje
                mapHistory = createMap('map-history');
                mapHistory.setView(map.getCenter(), map.getZoom());
                mapHistory.on('click', closeCard);
            }
            setTimeout(() => {
                // Tik perskaičiuojame dydį - vaizdas (taškas ir mastelis) lieka nepakitęs
                mapHistory.invalidateSize({ pan: false });
                renderHistoryPolylines();
            }, 50);
        }
    };
});

// ---------- Spalvos ----------
colors.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch ${i === 0 ? 'selected' : ''}`;
    swatch.style.backgroundColor = color;
    swatch.onclick = () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = color;
        customColorInput.value = color;
    };
    colorPalette.appendChild(swatch);
});

customColorInput.oninput = (e) => {
    selectedColor = e.target.value;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
};

// ---------- Pagalbinės funkcijos ----------
const formatTime = (sec) => {
    sec = Math.floor(sec);
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    const h = Math.floor(sec / 3600);
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
};

const formatDist = (m) => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';

const calcDist = (pts) => {
    let d = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        d += L.latLng(pts[i]).distanceTo(L.latLng(pts[i + 1]));
    }
    return d;
};

function saveLines() {
    try {
        localStorage.setItem('myNumberedLines', JSON.stringify(linesData));
    } catch (e) {
        console.warn('Nepavyko išsaugoti', e);
    }
}

// ---------- Linijos ----------
function createPolyline(line) {
    if (polylineMap.has(line.id)) return;
    const poly = L.polyline(line.points, { color: line.color, weight: LINE_WEIGHT, opacity: 0.85 }).addTo(map);

    poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showRouteCard(line, poly);
    });

    polylineMap.set(line.id, poly);
}

// Piešia visas linijas, NEKEIČIANT žemėlapio taško ir mastelio
function renderHistoryPolylines() {
    if (!mapHistory) return;

    selectedPoly = null;
    historyPolylineMap.forEach(poly => mapHistory.removeLayer(poly));
    historyPolylineMap.clear();

    let count = 0;
    linesData.forEach(line => {
        if (!line.points || line.points.length === 0) return;
        const poly = L.polyline(line.points, { color: line.color, weight: LINE_WEIGHT, opacity: 0.85 }).addTo(mapHistory);

        poly.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            showRouteCard(line, poly);
        });

        historyPolylineMap.set(line.id, poly);
        count++;
    });

    historyEmpty.classList.toggle('hidden', count > 0);
}

// Mygtukas "Rodyti visus" - tik paspaudus pritaiko vaizdą prie visų maršrutų
document.getElementById('fitAllBtn').onclick = () => {
    if (!mapHistory) return;
    const all = L.latLngBounds([]);
    historyPolylineMap.forEach(poly => all.extend(poly.getBounds()));
    if (all.isValid()) mapHistory.fitBounds(all, { padding: [60, 60], maxZoom: 17 });
};

// ---------- Meniu ----------
updateSelects();

document.getElementById('toggleMenuBtn').onclick = () => document.getElementById('drawMenu').classList.toggle('hidden');

document.querySelectorAll('input[name="lineOption"]').forEach(r => {
    r.onchange = (e) => lineSelect.classList.toggle('hidden', e.target.value !== 'continue');
});

function updateSelects() {
    lineSelect.innerHTML = '';
    deleteSelect.innerHTML = '<option value="">-- Pasirinkite --</option>';
    linesData.forEach(l => {
        lineSelect.add(new Option(`#${l.id}: ${l.name}`, l.id));
        deleteSelect.add(new Option(`#${l.id}: ${l.name}`, l.id));
    });
}

// ---------- GPS ----------
gpsDrawBtn.onclick = () => isGpsRecording ? stopGps() : startGps();

function startGps() {
    if (!('geolocation' in navigator)) return alert('GPS nepalaikomas');

    closeCard();
    lastAltitude = null;
    const isContinue = document.querySelector('input[name="lineOption"]:checked').value === 'continue';

    if (isContinue && linesData.length > 0) {
        const id = parseInt(lineSelect.value);
        currentLineData = linesData.find(l => l.id === id);
        if (!currentLineData) return alert('Pasirinkite maršrutą');
        currentLineData.color = selectedColor;
        currentLineData.elevationGain = currentLineData.elevationGain || 0;

        createPolyline(currentLineData);
        currentPolyline = polylineMap.get(id);
        currentPolyline.setStyle({ color: selectedColor });
        totalElapsed = currentLineData.duration || 0;
    } else {
        const id = linesData.length ? Math.max(...linesData.map(l => l.id)) + 1 : 1;
        currentLineData = {
            id, name: lineNameInput.value.trim() || `Žygis ${id}`,
            color: selectedColor, date: new Date().toLocaleDateString('lt-LT'),
            distance: 0, duration: 0, elevationGain: 0, points: []
        };
        linesData.push(currentLineData);
        createPolyline(currentLineData);
        currentPolyline = polylineMap.get(id);
        totalElapsed = 0;
    }

    watchId = navigator.geolocation.watchPosition(onGps, err => console.warn(err), { enableHighAccuracy: true });
    startTime = Date.now() - totalElapsed * 1000;
    timerInterval = setInterval(updateStats, 1000);

    isGpsRecording = true;
    gpsDrawBtn.textContent = 'Stabdyti GPS įrašymą';
    gpsDrawBtn.classList.add('active');
    statsPanel.classList.remove('hidden');
    document.getElementById('drawMenu').classList.add('hidden');
}

function onGps(pos) {
    const { latitude: lat, longitude: lng, accuracy, speed, altitude } = pos.coords;
    const pt = [lat, lng];

    if (!userMarker) {
        userMarker = L.circleMarker(pt, { radius: 8, fillColor: '#2563eb', color: '#fff', weight: 3, fillOpacity: 1 }).addTo(map);
        accuracyCircle = L.circle(pt, { radius: accuracy, color: '#2563eb', fillOpacity: 0.1, weight: 1 }).addTo(map);
    } else {
        userMarker.setLatLng(pt);
        accuracyCircle.setLatLng(pt).setRadius(accuracy);
    }
    map.setView(pt, map.getZoom());

    const pts = currentLineData.points;
    if (!pts.length || L.latLng(pts[pts.length - 1]).distanceTo(L.latLng(pt)) > 3) {
        pts.push(pt);
    }

    if (altitude !== null && altitude !== undefined) {
        if (lastAltitude !== null) {
            const diff = altitude - lastAltitude;
            if (diff > 1.5) {
                currentLineData.elevationGain = (currentLineData.elevationGain || 0) + diff;
                lastAltitude = altitude;
            } else if (diff < -1.5) {
                lastAltitude = altitude;
            }
        } else {
            lastAltitude = altitude;
        }
    }

    currentLineData.distance = calcDist(pts);
    currentPolyline.setLatLngs(pts);

    document.getElementById('statSpeed').textContent = `${(speed > 0 ? speed * 3.6 : 0).toFixed(1)} km/h`;
    document.getElementById('statElevation').textContent = `${Math.round(currentLineData.elevationGain || 0)} m`;
    updateStats();
}

function updateStats() {
    if (!isGpsRecording) return;
    totalElapsed = Math.floor((Date.now() - startTime) / 1000);
    currentLineData.duration = totalElapsed;

    document.getElementById('statTime').textContent = formatTime(totalElapsed);
    document.getElementById('statDistance').textContent = formatDist(currentLineData.distance);

    const km = currentLineData.distance / 1000;
    const hrs = totalElapsed / 3600;
    document.getElementById('statAvgSpeed').textContent = `${(hrs > 0 && km > 0 ? km / hrs : 0).toFixed(1)} km/h`;

    saveLines();
}

function stopGps() {
    navigator.geolocation.clearWatch(watchId);
    clearInterval(timerInterval);
    isGpsRecording = false;

    gpsDrawBtn.textContent = 'Pradėti GPS įrašymą';
    gpsDrawBtn.classList.remove('active');

    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }

    statsPanel.classList.add('hidden');

    // Jei žygis tuščias (nebuvo nė vieno GPS taško) - neišsaugome
    if (currentLineData && currentLineData.points.length === 0) {
        const id = currentLineData.id;
        if (polylineMap.has(id)) {
            map.removeLayer(polylineMap.get(id));
            polylineMap.delete(id);
        }
        linesData = linesData.filter(l => l.id !== id);
    }

    updateSelects();
    saveLines();
}

document.getElementById('deleteSelectedBtn').onclick = () => {
    const id = parseInt(deleteSelect.value);
    if (!id) return;

    if (isGpsRecording && currentLineData && currentLineData.id === id) {
        stopGps();
    }

    if (polylineMap.has(id)) {
        map.removeLayer(polylineMap.get(id));
        polylineMap.delete(id);
    }
    if (mapHistory && historyPolylineMap.has(id)) {
        mapHistory.removeLayer(historyPolylineMap.get(id));
        historyPolylineMap.delete(id);
    }

    linesData = linesData.filter(l => l.id !== id);
    saveLines();
    updateSelects();
    closeCard();
};
