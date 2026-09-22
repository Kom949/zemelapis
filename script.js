// 1. Žemėlapio inicijavimas
const map = L.map('map').setView([54.74622, 25.21294], 13);

// 2. MapTiler sluoksnis
L.tileLayer('https://api.maptiler.com/maps/topo-v4/256/{z}/{x}/{y}.png?key=fyz6kNYuQtvSwaBwX6CJ', {
    attribution: '&copy; MapTiler &copy; OpenStreetMap contributors'
}).addTo(map);

// 3. Estetiška, moderni 5 spalvų paletė
const colors = [
    '#2563eb', // Indigo Mėlyna
    '#10b981', // Smaragdo Žalia
    '#f43f5e', // Coral Rožinė
    '#f59e0b', // Gintarinė
    '#8b5cf6'  // Violetinė
];

let selectedColor = colors[0];

// Maršrutų atmintis
let linesData = JSON.parse(localStorage.getItem('myNumberedLines')) || [];
const polylineMap = new Map();

// GPS ir laikmačio kintamieji
let watchId = null;
let timerInterval = null;
let startTime = null;
let totalElapsedSeconds = 0;
let userMarker = null;
let accuracyCircle = null;
let isGpsRecording = false;
let currentLineData = null;
let currentPolyline = null;

// DOM Elementai
const colorPalette = document.getElementById('colorPalette');
const lineNameInput = document.getElementById('lineName');
const lineSelect = document.getElementById('lineSelect');
const deleteSelect = document.getElementById('deleteSelect');
const gpsDrawBtn = document.getElementById('gpsDrawBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const drawMenu = document.getElementById('drawMenu');
const toggleMenuBtn = document.getElementById('toggleMenuBtn');

// Statistikos DOM Elementai
const statsPanel = document.getElementById('statsPanel');
const statTime = document.getElementById('statTime');
const statDistance = document.getElementById('statDistance');
const statSpeed = document.getElementById('statSpeed');
const statAvgSpeed = document.getElementById('statAvgSpeed');

// Generuojame spalvų pasirinkimą
colors.forEach((color, index) => {
    const swatch = document.createElement('div');
    swatch.classList.add('color-swatch');
    swatch.style.backgroundColor = color;
    if (index === 0) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = color;
    });

    colorPalette.appendChild(swatch);
});

// Pagalbinės laiko ir atstumo funkcijos
function formatTime(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const pad = (num) => String(num).padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function calculateDistance(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = L.latLng(points[i][0], points[i][1]);
        const p2 = L.latLng(points[i + 1][0], points[i + 1][1]);
        total += p1.distanceTo(p2);
    }
    return total;
}

function formatDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toFixed(2) + ' km' : Math.round(meters) + ' m';
}

function createPolylineOnMap(line) {
    const distanceText = formatDistance(line.distance || 0);
    const dateText = line.date || 'Nenurodyta';
    const durationText = line.duration ? formatTime(line.duration) : 'Nenurodyta';

    const poly = L.polyline(line.points, { color: line.color, weight: 5 })
        .bindPopup(`<b>#${line.id}: ${line.name}</b><br>Atstumas: ${distanceText}<br>Trukme: ${durationText}<br>Sukurta: ${dateText}`)
        .bindTooltip(`#${line.id}: ${line.name} (${distanceText})`, { permanent: false, sticky: true })
        .addTo(map);
        
    polylineMap.set(line.id, poly);
}

// Užkrauname išsaugotus maršrutus
linesData.forEach(line => createPolylineOnMap(line));
updateDeleteSelectOptions();

toggleMenuBtn.addEventListener('click', () => drawMenu.classList.toggle('hidden'));

document.querySelectorAll('input[name="lineOption"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'continue') {
            updateLineSelectOptions();
            lineSelect.classList.remove('hidden');
        } else {
            lineSelect.classList.add('hidden');
        }
    });
});

function updateLineSelectOptions() {
    lineSelect.innerHTML = '';
    linesData.forEach(line => {
        const option = document.createElement('option');
        option.value = line.id;
        option.textContent = `#${line.id}: ${line.name}`;
        lineSelect.appendChild(option);
    });
}

function updateDeleteSelectOptions() {
    deleteSelect.innerHTML = '<option value="">-- Pasirinkite maršrutą --</option>';
    linesData.forEach(line => {
        const option = document.createElement('option');
        option.value = line.id;
        option.textContent = `#${line.id}: ${line.name}`;
        deleteSelect.appendChild(option);
    });
}

// --- REALAU LAIKO GPS SEKOJIMAS ir MATAVIMAI ---
gpsDrawBtn.addEventListener('click', () => {
    if (!isGpsRecording) {
        startGpsTracking();
    } else {
        stopGpsTracking();
    }
});

function startGpsTracking() {
    if (!('geolocation' in navigator)) {
        alert('Jūsų naršyklė arba įrenginys nepalaiko GPS geolokacijos.');
        return;
    }

    const option = document.querySelector('input[name="lineOption"]:checked').value;

    if (option === 'continue' && linesData.length > 0) {
        const selectedId = parseInt(lineSelect.value);
        currentLineData = linesData.find(l => l.id === selectedId);
        currentLineData.color = selectedColor;
        currentPolyline = polylineMap.get(selectedId);
        currentPolyline.setStyle({ color: selectedColor });
        totalElapsedSeconds = currentLineData.duration || 0;
    } else {
        const newId = linesData.length > 0 ? Math.max(...linesData.map(l => l.id)) + 1 : 1;
        const name = lineNameInput.value.trim() || `Pasivaikščiojimas ${newId}`;
        const now = new Date().toLocaleString('lt-LT');

        currentLineData = {
            id: newId,
            name: name,
            color: selectedColor,
            date: now,
            distance: 0,
            duration: 0,
            points: []
        };

        linesData.push(currentLineData);
        createPolylineOnMap(currentLineData);
        currentPolyline = polylineMap.get(newId);
        totalElapsedSeconds = 0;
    }

    // Paleidžiame GPS sekimą
    watchId = navigator.geolocation.watchPosition(
        onGpsSuccess,
        onGpsError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        }
    );

    // Paleidžiame laikmatį
    startTime = Date.now() - (totalElapsedSeconds * 1000);
    timerInterval = setInterval(updateStatsUI, 1000);

    isGpsRecording = true;
    gpsDrawBtn.textContent = 'Stabdyti GPS įrašymą';
    gpsDrawBtn.classList.add('active');
    statsPanel.classList.remove('hidden');
}

function onGpsSuccess(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const rawSpeed = position.coords.speed; // greitis m/s iš GPS jutiklio
    const newPoint = [lat, lng];

    // Žymeklis
    if (!userMarker) {
        userMarker = L.circleMarker(newPoint, {
            radius: 7,
            fillColor: '#2563eb',
            color: '#ffffff',
            weight: 3,
            fillOpacity: 1
        }).addTo(map);

        accuracyCircle = L.circle(newPoint, {
            radius: accuracy,
            color: '#2563eb',
            fillColor: '#2563eb',
            fillOpacity: 0.1,
            weight: 1
        }).addTo(map);
    } else {
        userMarker.setLatLng(newPoint);
        accuracyCircle.setLatLng(newPoint);
        accuracyCircle.setRadius(accuracy);
    }

    map.setView(newPoint, map.getZoom());

    // Pridedame tašką, jei pasislinkome > 3 metrus
    const points = currentLineData.points;
    if (points.length === 0) {
        points.push(newPoint);
    } else {
        const lastPoint = points[points.length - 1];
        const distMeters = L.latLng(lastPoint[0], lastPoint[1]).distanceTo(L.latLng(lat, lng));

        if (distMeters > 3) {
            points.push(newPoint);
        }
    }

    // Atnaujiname atstumą
    currentLineData.distance = calculateDistance(points);
    currentPolyline.setLatLngs(points);

    // Esamas greitis km/h (m/s * 3.6)
    let currentSpeedKmH = 0;
    if (rawSpeed !== null && rawSpeed > 0) {
        currentSpeedKmH = rawSpeed * 3.6;
    }
    statSpeed.textContent = `${currentSpeedKmH.toFixed(1)} km/h`;

    updateStatsUI();
}

function updateStatsUI() {
    if (!isGpsRecording) return;

    // Skaičiuojame trukmę
    totalElapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    currentLineData.duration = totalElapsedSeconds;
    statTime.textContent = formatTime(totalElapsedSeconds);

    // Atstumo atvaizdavimas
    const meters = currentLineData.distance || 0;
    statDistance.textContent = formatDistance(meters);

    // Vidutinio greičio skaičiavimas (km / h)
    if (totalElapsedSeconds > 0 && meters > 0) {
        const km = meters / 1000;
        const hours = totalElapsedSeconds / 3600;
        const avgSpeed = km / hours;
        statAvgSpeed.textContent = `${avgSpeed.toFixed(1)} km/h`;
    } else {
        statAvgSpeed.textContent = '0.0 km/h';
    }

    // Popup/Tooltip atnaujinimas
    const distText = formatDistance(meters);
    const durationText = formatTime(totalElapsedSeconds);
    currentPolyline.setPopupContent(`<b>#${currentLineData.id}: ${currentLineData.name}</b><br>Atstumas: ${distText}<br>Trukmė: ${durationText}<br>Sukurta: ${currentLineData.date}`);
    currentPolyline.setTooltipContent(`#${currentLineData.id}: ${currentLineData.name} (${distText})`);

    localStorage.setItem('myNumberedLines', JSON.stringify(linesData));
}

function onGpsError(err) {
    console.warn(`GPS klaida (${err.code}): ${err.message}`);
}

function stopGpsTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    isGpsRecording = false;
    gpsDrawBtn.textContent = 'Pradėti GPS įrašymą';
    gpsDrawBtn.classList.remove('active');
    statSpeed.textContent = '0.0 km/h';

    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    if (accuracyCircle) {
        map.removeLayer(accuracyCircle);
        accuracyCircle = null;
    }

    updateDeleteSelectOptions();
}

// Ištrynimo funkcija
deleteSelectedBtn.addEventListener('click', () => {
    const selectedId = parseInt(deleteSelect.value);
    if (!selectedId) return;

    const poly = polylineMap.get(selectedId);
    if (poly) {
        map.removeLayer(poly);
        polylineMap.delete(selectedId);
    }

    linesData = linesData.filter(l => l.id !== selectedId);
    localStorage.setItem('myNumberedLines', JSON.stringify(linesData));

    updateDeleteSelectOptions();
    if (document.querySelector('input[name="lineOption"]:checked').value === 'continue') {
        updateLineSelectOptions();
    }
});
