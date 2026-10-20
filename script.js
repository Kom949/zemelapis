// SUPABASE PRISIJUNGIMAS
const SUPABASE_URL = 'https://hxbkmstegyimjkbnlgfa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lfVhNCx5D-iVDFOm44vjHQ_ErK0Zsnt';
let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const TILE_URL = 'https://api.maptiler.com/maps/topo-v4/256/{z}/{x}/{y}.png?key=fyz6kNYuQtvSwaBwX6CJ';
const TILE_OPTIONS = { attribution: '&copy; MapTiler &copy; OpenStreetMap', maxZoom: 19 };
const DEFAULT_CENTER = [54.74622, 25.21294];
const DEFAULT_ZOOM = 13;
const LINE_WEIGHT = 6;
const LINE_WEIGHT_ACTIVE = 10;

let map = null;
let mapHistory = null;
const historyPolylineMap = new Map();
const polylineMap = new Map();

const colors = ['#2563eb', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6'];
let selectedColor = colors[0];
let linesData = [];

let watchId = null, timerInterval = null, startTime = null, totalElapsed = 0;
let userMarker = null, accuracyCircle = null, isGpsRecording = false;
let currentLineData = null, currentPolyline = null;
let lastAltitude = null;

// DOM Elementai autentifikacijai
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authTitle = document.getElementById('authTitle');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const toggleAuthBtn = document.getElementById('toggleAuthBtn');
const toggleAuthText = document.getElementById('toggleAuthText');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const logoutBtn = document.getElementById('logoutBtn');

let isSignUpMode = false;

// Autentifikacijos perjungimas
if (toggleAuthBtn) {
    toggleAuthBtn.onclick = (e) => {
        e.preventDefault();
        isSignUpMode = !isSignUpMode;
        authTitle.textContent = isSignUpMode ? 'Registracija' : 'Prisijungimas';
        authSubmitBtn.textContent = isSignUpMode ? 'Registruotis' : 'Prisijungti';
        toggleAuthText.textContent = isSignUpMode ? 'Jau turite paskyrą?' : 'Neturite paskyros?';
        toggleAuthBtn.textContent = isSignUpMode ? 'Prisijungti' : 'Registruotis';
    };
}

// Prisijungimo / Registracijos formos pateikimas
if (authForm) {
    authForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = authEmail.value.trim();
        const password = authPassword.value.trim();

        if (isSignUpMode) {
            const { data, error } = await supabaseClient.auth.signUp({ email, password });
            if (error) alert('Registracijos klaida: ' + error.message);
            else {
                alert('Registracija sėkminga! Dabar galite prisijungti.');
                isSignUpMode = false;
                authTitle.textContent = 'Prisijungimas';
                authSubmitBtn.textContent = 'Prisijungti';
            }
        } else {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) alert('Prisijungimo klaida: ' + error.message);
            else if (data.user) {
                initApp(data.user);
            }
        }
    };
}

if (logoutBtn) {
    logoutBtn.onclick = async () => {
        await supabaseClient.auth.signOut();
        location.reload();
    };
}

function initApp(user) {
    authContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    userEmailDisplay.textContent = user.email;

    // Sukuriamas pagrindinis žemėlapis
    map = createMap('map');
    uzkrautiIsSupabase();
}

function createMap(id) {
    const m = L.map(id, {
        zoomControl: false,
        renderer: L.canvas({ tolerance: 14 })
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    return m;
}

const colorPalette = document.getElementById('colorPalette');
const customColorInput = document.getElementById('customColor');
const lineNameInput = document.getElementById('lineName');
const lineSelect = document.getElementById('lineSelect');
const deleteSelect = document.getElementById('deleteSelect');
const gpsDrawBtn = document.getElementById('gpsDrawBtn');
const statsPanel = document.getElementById('statsPanel');
const historyEmpty = document.getElementById('history-empty');

const infoCard = document.getElementById('info-card');
const cardTitle = document.getElementById('card-title');
const cardDot = document.getElementById('card-dot');
const cardDuration = document.getElementById('card-duration');
const cardDistance = document.getElementById('card-distance');
const cardSpeed = document.getElementById('card-speed');
const cardElevation = document.getElementById('card-elevation');
const cardDate = document.getElementById('card-date');
const closeBtn = document.getElementById('close-btn');

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
if (closeBtn) closeCard();
if (map) map.on('click', closeCard);

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

// Skilčių perjungimas
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
            setTimeout(() => map && map.invalidateSize(), 50);
        } else if (tabName === 'history') {
            if (!mapHistory) {
                mapHistory = createMap('map-history');
                mapHistory.setView(map.getCenter(), map.getZoom());
                mapHistory.on('click', closeCard);
            }
            setTimeout(() => {
                mapHistory.invalidateSize({ pan: false });
                renderHistoryPolylines();
            }, 50);
        }
    };
});

// Spalvų paletė
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
    if (colorPalette) colorPalette.appendChild(swatch);
});

if (customColorInput) {
    customColorInput.oninput = (e) => {
        selectedColor = e.target.value;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    };
}

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

// Supabase duomenų sinchronizacija
async function uzkrautiIsSupabase() {
    const { data, error } = await supabaseClient.from('zygiai').select('*');
    if (data) {
        linesData = data.map(item => ({
            id: item.id,
            name: item.title || 'Maršrutas',
            color: item.color || '#2563eb',
            points: item.coordinates || [],
            distance: item.distance || 0,
            duration: item.duration || 0,
            elevationGain: item.elevationGain || 0,
            date: item.date || '-'
        }));

        linesData.forEach(line => {
            if (line.points && line.points.length > 0) {
                createPolyline(line);
            }
        });
        updateSelects();
    }
}

async function isaugotiISupabase(line) {
    // Paimame dabartinio prisijungusio vartotojo informaciją
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data, error } = await supabaseClient.from('zygiai').insert([{
        title: line.name,
        coordinates: line.points,
        color: line.color,
        distance: line.distance,
        duration: line.duration,
        elevationGain: line.elevationGain,
        date: line.date,
        user_id: user.id // <--- Priskiriame prisijungusio vartotojo ID dėl RLS apsaugos
    }]).select();

    if (error) {
        console.error("Klaida išsaugant į Supabase:", error.message);
    } else if (data && data.length > 0) {
        line.id = data[0].id;
        updateSelects();
    }
}

async function istrintiIsSupabase(id) {
    await supabaseClient.from('zygiai').delete().eq('id', id);
}

function createPolyline(line) {
    if (polylineMap.has(line.id)) return;
    const poly = L.polyline(line.points, { color: line.color, weight: LINE_WEIGHT, opacity: 0.85 }).addTo(map);
    poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showRouteCard(line, poly);
    });
    polylineMap.set(line.id, poly);
}

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

const fitAllBtn = document.getElementById('fitAllBtn');
if (fitAllBtn) {
    fitAllBtn.onclick = () => {
        if (!mapHistory) return;
        const all = L.latLngBounds([]);
        historyPolylineMap.forEach(poly => all.extend(poly.getBounds()));
        if (all.isValid()) mapHistory.fitBounds(all, { padding: [60, 60], maxZoom: 17 });
    };
}

const toggleMenuBtn = document.getElementById('toggleMenuBtn');
if (toggleMenuBtn) {
    toggleMenuBtn.onclick = () => document.getElementById('drawMenu').classList.toggle('hidden');
}

document.querySelectorAll('input[name="lineOption"]').forEach(r => {
    r.onchange = (e) => lineSelect.classList.toggle('hidden', e.target.value !== 'continue');
});

function updateSelects() {
    if (!lineSelect || !deleteSelect) return;
    lineSelect.innerHTML = '';
    deleteSelect.innerHTML = '<option value="">-- Pasirinkite --</option>';
    linesData.forEach(l => {
        lineSelect.add(new Option(`#${l.id}: ${l.name}`, l.id));
        deleteSelect.add(new Option(`#${l.id}: ${l.name}`, l.id));
    });
}

// GPS Įrašymo logika
if (gpsDrawBtn) {
    gpsDrawBtn.onclick = () => isGpsRecording ? stopGps() : startGps();
}

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
        if (currentPolyline) currentPolyline.setStyle({ color: selectedColor });
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
    if (currentPolyline) currentPolyline.setLatLngs(pts);

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
}

async function stopGps() {
    navigator.geolocation.clearWatch(watchId);
    clearInterval(timerInterval);
    isGpsRecording = false;

    gpsDrawBtn.textContent = 'Pradėti GPS įrašymą';
    gpsDrawBtn.classList.remove('active');

    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }

    statsPanel.classList.add('hidden');

    if (currentLineData && currentLineData.points.length > 0) {
        await isaugotiISupabase(currentLineData);
    }

    updateSelects();
}

const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
if (deleteSelectedBtn) {
    deleteSelectedBtn.onclick = async () => {
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
        await istrintiIsSupabase(id);
        updateSelects();
        closeCard();
    };
}