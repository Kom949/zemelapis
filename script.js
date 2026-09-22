const map = L.map('map').setView([54.74622, 25.21294], 13);
L.tileLayer('https://api.maptiler.com/maps/topo-v4/256/{z}/{x}/{y}.png?key=fyz6kNYuQtvSwaBwX6CJ', {
    attribution: '&copy; MapTiler &copy; OpenStreetMap'
}).addTo(map);

const colors = ['#2563eb', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6'];
let selectedColor = colors[0];

let linesData = JSON.parse(localStorage.getItem('myNumberedLines')) || [];
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

// Spalvų pasirinkimas ir spalvos ratas
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

const formatTime = (sec) => {
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

function createPolyline(line) {
    const poly = L.polyline(line.points, { color: line.color, weight: 5 })
        .bindPopup(`<b>#${line.id}: ${line.name}</b><br>Atstumas: ${formatDist(line.distance)}<br>Trukmė: ${formatTime(line.duration || 0)}<br>Sukilimas: ${Math.round(line.elevationGain || 0)} m`)
        .addTo(map);
    polylineMap.set(line.id, poly);
}

linesData.forEach(createPolyline);
updateSelects();

document.getElementById('toggleMenuBtn').onclick = () => document.getElementById('drawMenu').classList.toggle('hidden');

document.querySelectorAll('input[name="lineOption"]').forEach(r => {
    r.onchange = (e) => lineSelect.classList.toggle('hidden', e.target.value !== 'continue');
});

function updateSelects() {
    lineSelect.innerHTML = '';
    deleteSelect.innerHTML = '<option value="">-- Pasirinkite ištrinti --</option>';
    linesData.forEach(l => {
        lineSelect.add(new Option(`#${l.id}: ${l.name}`, l.id));
        deleteSelect.add(new Option(`#${l.id}: ${l.name}`, l.id));
    });
}

gpsDrawBtn.onclick = () => isGpsRecording ? stopGps() : startGps();

function startGps() {
    if (!('geolocation' in navigator)) return alert('GPS nepalaikomas');

    lastAltitude = null;
    const isContinue = document.querySelector('input[name="lineOption"]:checked').value === 'continue';
    if (isContinue && linesData.length > 0) {
        const id = parseInt(lineSelect.value);
        currentLineData = linesData.find(l => l.id === id);
        currentLineData.color = selectedColor;
        currentLineData.elevationGain = currentLineData.elevationGain || 0;
        currentPolyline = polylineMap.get(id);
        currentPolyline.setStyle({ color: selectedColor });
        totalElapsed = currentLineData.duration || 0;
    } else {
        const id = linesData.length ? Math.max(...linesData.map(l => l.id)) + 1 : 1;
        currentLineData = {
            id, name: lineNameInput.value.trim() || `Maršrutas ${id}`,
            color: selectedColor, date: new Date().toLocaleString('lt-LT'),
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
    gpsDrawBtn.textContent = 'Stabdyti GPS';
    gpsDrawBtn.classList.add('active');
    statsPanel.classList.remove('hidden');
}

function onGps(pos) {
    const { latitude: lat, longitude: lng, accuracy, speed, altitude } = pos.coords;
    const pt = [lat, lng];

    if (!userMarker) {
        userMarker = L.circleMarker(pt, { radius: 6, fillColor: '#2563eb', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
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

    // Aukščio padidėjimo skaičiavimas (filtracija nuo >1.5 m nuokrypių)
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

    currentPolyline.setPopupContent(`<b>#${currentLineData.id}: ${currentLineData.name}</b><br>Atstumas: ${formatDist(currentLineData.distance)}<br>Trukmė: ${formatTime(totalElapsed)}<br>Sukilimas: ${Math.round(currentLineData.elevationGain || 0)} m`);
    localStorage.setItem('myNumberedLines', JSON.stringify(linesData));
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
    updateSelects();
}

document.getElementById('deleteSelectedBtn').onclick = () => {
    const id = parseInt(deleteSelect.value);
    if (!id) return;
    map.removeLayer(polylineMap.get(id));
    polylineMap.delete(id);
    linesData = linesData.filter(l => l.id !== id);
    localStorage.setItem('myNumberedLines', JSON.stringify(linesData));
    updateSelects();
};