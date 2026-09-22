// 1. Žemėlapio inicijavimas
const map = L.map('map').setView([54.74622, 25.21294], 12);

// 2. MapTiler sluoksnis
L.tileLayer('https://api.maptiler.com/maps/topo-v4/256/{z}/{x}/{y}.png?key=fyz6kNYuQtvSwaBwX6CJ', {
    attribution: '&copy; MapTiler &copy; OpenStreetMap contributors'
}).addTo(map);

// 3. Spalvų pasirinkimai
const colors = [
    '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    '#469990', '#dcbeff', '#9A6324', '#000000', '#808080'
];

let selectedColor = colors[0];

// Maršrutų atmintis
let linesData = JSON.parse(localStorage.getItem('myNumberedLines')) || [];
const polylineMap = new Map();

// Rankinio braižymo kintamieji
let isDrawingMode = false;
let isMouseDown = false;
let currentLineData = null;
let currentPolyline = null;

// GPS sekimo kintamieji
let watchId = null;
let userMarker = null;
let accuracyCircle = null;
let isGpsRecording = false;

// DOM Elementai
const colorPalette = document.getElementById('colorPalette');
const customColorInput = document.getElementById('customColor');
const lineNameInput = document.getElementById('lineName');
const lineSelect = document.getElementById('lineSelect');
const deleteSelect = document.getElementById('deleteSelect');
const startDrawBtn = document.getElementById('startDrawBtn');
const stopDrawBtn = document.getElementById('stopDrawBtn');
const gpsDrawBtn = document.getElementById('gpsDrawBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const drawMenu = document.getElementById('drawMenu');
const toggleMenuBtn = document.getElementById('toggleMenuBtn');

// Generuojame spalvų paletę
colors.forEach((color, index) => {
    const swatch = document.createElement('div');
    swatch.classList.add('color-swatch');
    swatch.style.backgroundColor = color;
    if (index === 0) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = color;
        customColorInput.value = color;
    });

    colorPalette.appendChild(swatch);
});

customColorInput.addEventListener('input', (e) => {
    selectedColor = e.target.value;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
});

// Skaičiavimo funkcijos
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

    const poly = L.polyline(line.points, { color: line.color, weight: 5 })
        .bindPopup(`<b>#${line.id}: ${line.name}</b><br>Atstumas: ${distanceText}<br>Sukurta: ${dateText}`)
        .bindTooltip(`#${line.id}: ${line.name} (${distanceText})`, { permanent: false, sticky: true })
        .addTo(map);
        
    polylineMap.set(line.id, poly);
}

// Užkrauname esamus duomenis
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

// --- RANKINIS BRAIŽYMAS PELE ---
startDrawBtn.addEventListener('click', () => {
    if (isGpsRecording) stopGpsTracking();

    const option = document.querySelector('input[name="lineOption"]:checked').value;

    if (option === 'continue' && linesData.length > 0) {
        const selectedId = parseInt(lineSelect.value);
        currentLineData = linesData.find(l => l.id === selectedId);
        currentLineData.color = selectedColor;
        currentPolyline = polylineMap.get(selectedId);
        currentPolyline.setStyle({ color: selectedColor });
    } else {
        const newId = linesData.length > 0 ? Math.max(...linesData.map(l => l.id)) + 1 : 1;
        const name = lineNameInput.value.trim() || `Maršrutas ${newId}`;
        const now = new Date().toLocaleString('lt-LT');

        currentLineData = {
            id: newId,
            name: name,
            color: selectedColor,
            date: now,
            distance: 0,
            points: []
        };

        linesData.push(currentLineData);
        createPolylineOnMap(currentLineData);
        currentPolyline = polylineMap.get(newId);
    }

    isDrawingMode = true;
    map.dragging.disable();
    startDrawBtn.classList.add('hidden');
    stopDrawBtn.classList.remove('hidden');
});

stopDrawBtn.addEventListener('click', stopDrawing);

function stopDrawing() {
    isDrawingMode = false;
    map.dragging.enable();
    startDrawBtn.classList.remove('hidden');
    stopDrawBtn.classList.add('hidden');
    lineNameInput.value = '';
    updateDeleteSelectOptions();
}

map.on('mousedown', (e) => {
    if (!isDrawingMode) return;
    isMouseDown = true;
    currentLineData.points.push([e.latlng.lat, e.latlng.lng]);
    currentPolyline.setLatLngs(currentLineData.points);
});

map.on('mousemove', (e) => {
    if (!isDrawingMode || !isMouseDown) return;
    currentLineData.points.push([e.latlng.lat, e.latlng.lng]);
    currentPolyline.setLatLngs(currentLineData.points);
});

map.on('mouseup', () => {
    if (!isDrawingMode || !isMouseDown) return;
    isMouseDown = false;

    currentLineData.distance = calculateDistance(currentLineData.points);
    const distText = formatDistance(currentLineData.distance);

    currentPolyline.setPopupContent(`<b>#${currentLineData.id}: ${currentLineData.name}</b><br>Atstumas: ${distText}<br>Sukurta: ${currentLineData.date}`);
    currentPolyline.setTooltipContent(`#${currentLineData.id}: ${currentLineData.name} (${distText})`);

    localStorage.setItem('myNumberedLines', JSON.stringify(linesData));
    updateDeleteSelectOptions();
});

// --- REALAU LAIKO GPS SEKOJIMAS ---
gpsDrawBtn.addEventListener('click', () => {
    if (!isGpsRecording) {
        if (isDrawingMode) stopDrawing();
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
    } else {
        const newId = linesData.length > 0 ? Math.max(...linesData.map(l => l.id)) + 1 : 1;
        const name = lineNameInput.value.trim() || `GPS Maršrutas ${newId}`;
        const now = new Date().toLocaleString('lt-LT');

        currentLineData = {
            id: newId,
            name: name,
            color: selectedColor,
            date: now,
            distance: 0,
            points: []
        };

        linesData.push(currentLineData);
        createPolylineOnMap(currentLineData);
        currentPolyline = polylineMap.get(newId);
    }

    watchId = navigator.geolocation.watchPosition(
        onGpsSuccess,
        onGpsError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        }
    );

    isGpsRecording = true;
    gpsDrawBtn.textContent = 'Stabdyti GPS įrašymą';
    gpsDrawBtn.classList.add('active');
}

function onGpsSuccess(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const newPoint = [lat, lng];

    // Žymeklio atnaujinimas žemėlapyje
    if (!userMarker) {
        userMarker = L.circleMarker(newPoint, {
            radius: 8,
            fillColor: '#007bff',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(map);

        accuracyCircle = L.circle(newPoint, {
            radius: accuracy,
            color: '#007bff',
            fillColor: '#007bff',
            fillOpacity: 0.15,
            weight: 1
        }).addTo(map);
    } else {
        userMarker.setLatLng(newPoint);
        accuracyCircle.setLatLng(newPoint);
        accuracyCircle.setRadius(accuracy);
    }

    map.setView(newPoint, map.getZoom());

    // Filtravimas: pridedame tašką tik pasislinkus > 3 metrus
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

    currentPolyline.setLatLngs(points);
    currentLineData.distance = calculateDistance(points);
    
    const distText = formatDistance(currentLineData.distance);
    currentPolyline.setPopupContent(`<b>#${currentLineData.id}: ${currentLineData.name}</b><br>Atstumas: ${distText}<br>Sukurta: ${currentLineData.date}`);
    currentPolyline.setTooltipContent(`#${currentLineData.id}: ${currentLineData.name} (${distText})`);

    localStorage.setItem('myNumberedLines', JSON.stringify(linesData));
    updateDeleteSelectOptions();
}

function onGpsError(err) {
    console.warn(`GPS klaida (${err.code}): ${err.message}`);
    alert('Nepavyko gauti GPS vietos. Patikrinkite, ar įjungti vietos nustatymai.');
}

function stopGpsTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    isGpsRecording = false;
    gpsDrawBtn.textContent = 'Sekioti su GPS';
    gpsDrawBtn.classList.remove('active');

    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    if (accuracyCircle) {
        map.removeLayer(accuracyCircle);
        accuracyCircle = null;
    }
}

// Ištrynimas
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