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

const colors = ['#2563eb', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6'];
let selectedColor = colors[0];
let linesData = [];

let watchId = null, timerInterval = null, startTime = null, totalElapsed = 0;
let userMarker = null, accuracyCircle = null, isGpsRecording = false;
let currentLineData = null, currentPolyline = null;

// ---- GPS filtravimo parametrai ----
const MAX_ACCURACY = 25;        // m  – fiksavimai, blogesni už šį, ignoruojami
const MIN_STEP = 5;             // m  – mažiausias žingsnis (be to, bent tiek, kiek paklaida)
const MAX_SPEED = 12;           // m/s – greitesni šuoliai laikomi GPS klaida (~43 km/h)
const MAX_ALT_ACCURACY = 15;    // m  – blogesnio aukščio tikslumo ignoruojame
const ELEV_THRESHOLD = 7;       // m  – kilimas skaičiuojamas tik pasikeitus aukščiui bent tiek
const STILL_TIMEOUT = 6000;     // ms – tiek be judėjimo = greitis 0

let lastFix = null;             // { pt, t } paskutinis priimtas taškas
let rejectedInRow = 0;
let curSpeed = 0, lastMoveTime = 0;
let altWindow = [], smoothAlt = null, anchorAlt = null;
let wakeLock = null;

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
    map.on('click', closeCard);
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
if (closeBtn) closeBtn.onclick = closeCard;

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

function switchTab(tabName, onReady) {
    navItems.forEach(nav => nav.classList.toggle('active', nav.getAttribute('data-tab') === tabName));
    tabContents.forEach(tab => tab.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    closeCard();

    if (tabName === 'record') {
        setTimeout(() => { map && map.invalidateSize(); if (onReady) onReady(); }, 50);
    } else if (tabName === 'history') {
        if (!mapHistory) {
            mapHistory = createMap('map-history');
            mapHistory.setView(map.getCenter(), map.getZoom());
            mapHistory.on('click', closeCard);
        }
        setTimeout(() => {
            mapHistory.invalidateSize({ pan: false });
            renderHistoryPolylines();
            if (onReady) onReady();
        }, 50);
    } else if (onReady) {
        onReady();
    }
}

navItems.forEach(item => {
    item.onclick = () => switchTab(item.getAttribute('data-tab'));
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
    const { data, error } = await supabaseClient.from('zygiai').select('*').order('id', { ascending: true });
    if (error) { console.error('Klaida kraunant:', error.message); return; }
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
        updateSelects();
    }
}

// Naujas žygis -> INSERT, tęsiamas -> UPDATE (anksčiau tęsiant būdavo sukuriamas dublikatas)
async function isaugotiISupabase(line) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return false;

    const payload = {
        title: line.name,
        coordinates: line.points,
        color: line.color,
        distance: Math.round(line.distance),
        duration: Math.round(line.duration),
        elevationGain: Math.round(line.elevationGain || 0),
        date: line.date
    };

    if (line.isNew) {
        const { data, error } = await supabaseClient.from('zygiai')
            .insert([{ ...payload, user_id: user.id }]).select();
        if (error || !data || !data.length) {
            console.error('Klaida išsaugant:', error && error.message);
            return false;
        }
        line.id = data[0].id;
        line.isNew = false;
        return true;
    } else {
        const { error } = await supabaseClient.from('zygiai').update(payload).eq('id', line.id);
        if (error) { console.error('Klaida atnaujinant:', error.message); return false; }
        return true;
    }
}

async function istrintiIsSupabase(id) {
    const { error } = await supabaseClient.from('zygiai').delete().eq('id', id);
    if (error) console.error('Klaida trinant:', error.message);
}

// Įrašymo žemėlapyje piešiamas tik šiuo metu įrašomas maršrutas
function createRecordingPolyline(line) {
    return L.polyline(line.points, { color: line.color, weight: LINE_WEIGHT, opacity: 0.85 }).addTo(map);
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
    gpsDrawBtn.onclick = () => isGpsRecording ? stopGps(true) : startGps();
}

async function acquireWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* nepalaikoma – ignoruojame */ }
}
function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
// Grįžus į programėlę ekrano užraktas atnaujinamas
document.addEventListener('visibilitychange', () => {
    if (isGpsRecording && document.visibilityState === 'visible') acquireWakeLock();
});

const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function startGps() {
    if (!('geolocation' in navigator)) return alert('GPS nepalaikomas');

    closeCard();
    const isContinue = document.querySelector('input[name="lineOption"]:checked').value === 'continue';

    if (isContinue) {
        const id = parseInt(lineSelect.value);
        currentLineData = linesData.find(l => l.id === id);
        if (!currentLineData) return alert('Pasirinkite maršrutą');
        currentLineData.color = selectedColor;
        currentLineData.elevationGain = currentLineData.elevationGain || 0;
        totalElapsed = currentLineData.duration || 0;
    } else {
        currentLineData = {
            id: null, isNew: true,
            name: lineNameInput.value.trim() || `Žygis ${linesData.length + 1}`,
            color: selectedColor, date: new Date().toLocaleDateString('lt-LT'),
            distance: 0, duration: 0, elevationGain: 0, points: []
        };
        totalElapsed = 0;
    }
    currentPolyline = createRecordingPolyline(currentLineData);

    // Išvalome filtrų būseną
    lastFix = null; rejectedInRow = 0;
    curSpeed = 0; lastMoveTime = 0;
    altWindow = []; smoothAlt = null; anchorAlt = null;

    watchId = navigator.geolocation.watchPosition(onGps, onGpsError, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 20000
    });
    startTime = Date.now() - totalElapsed * 1000;
    timerInterval = setInterval(updateStats, 1000);
    acquireWakeLock();

    isGpsRecording = true;
    gpsDrawBtn.textContent = 'Stabdyti GPS įrašymą';
    gpsDrawBtn.classList.add('active');
    statsPanel.classList.remove('hidden');
    document.getElementById('drawMenu').classList.add('hidden');
    updateStats();
}

function onGpsError(err) {
    console.warn(err);
    if (err.code === 1) {
        alert('Nėra leidimo naudoti GPS. Leiskite vietos nustatymą naršyklės nustatymuose.');
        stopGps(false);
    }
}

// Aukščio kilimas: mediana + glotninimas + slenkstis (histerezė)
function processAltitude(alt) {
    altWindow.push(alt);
    if (altWindow.length > 5) altWindow.shift();
    const med = median(altWindow);
    smoothAlt = smoothAlt === null ? med : smoothAlt + 0.3 * (med - smoothAlt);

    if (anchorAlt === null) { anchorAlt = smoothAlt; return; }
    const diff = smoothAlt - anchorAlt;
    if (diff >= ELEV_THRESHOLD) {
        currentLineData.elevationGain += diff;
        anchorAlt = smoothAlt;
    } else if (diff <= -ELEV_THRESHOLD) {
        anchorAlt = smoothAlt;
    }
}

function onGps(pos) {
    if (!isGpsRecording || !currentLineData) return;

    const { latitude: lat, longitude: lng, accuracy, speed, altitude, altitudeAccuracy } = pos.coords;
    const t = pos.timestamp || Date.now();
    const pt = [lat, lng];

    // Vartotojo žymeklis rodomas visada, kad matytųsi GPS būklė
    if (!userMarker) {
        userMarker = L.circleMarker(pt, { radius: 8, fillColor: '#2563eb', color: '#fff', weight: 3, fillOpacity: 1 }).addTo(map);
        accuracyCircle = L.circle(pt, { radius: accuracy, color: '#2563eb', fillOpacity: 0.1, weight: 1 }).addTo(map);
    } else {
        userMarker.setLatLng(pt);
        accuracyCircle.setLatLng(pt).setRadius(accuracy);
    }
    map.setView(pt, map.getZoom());

    // 1) Per prastas tikslumas – neįtraukiame į matavimus
    if (!(accuracy <= MAX_ACCURACY)) return;

    const pts = currentLineData.points;

    if (lastFix) {
        const dt = (t - lastFix.t) / 1000;
        if (dt <= 0) return;
        const d = L.latLng(lastFix.pt).distanceTo(L.latLng(pt));

        // 2) Vietoje stovėjimo GPS „šokinėja“ – judesys turi viršyti paklaidą
        if (d < Math.max(MIN_STEP, accuracy)) return;

        // 3) Neįmanomi šuoliai
        if (d / dt > MAX_SPEED) {
            rejectedInRow++;
            if (rejectedInRow < 5) return;
            // 5 iš eilės – tikriausiai signalas atsistatė kitoje vietoje; pradedame iš naujo be atstumo
            lastFix = { pt, t };
            pts.push(pt);
            if (currentPolyline) currentPolyline.setLatLngs(pts);
            rejectedInRow = 0;
            return;
        }
        rejectedInRow = 0;

        currentLineData.distance += d;

        // Dabartinis greitis (glotninamas)
        const raw = (typeof speed === 'number' && isFinite(speed) && speed >= 0) ? speed : d / dt;
        curSpeed = curSpeed === 0 ? raw : curSpeed * 0.6 + raw * 0.4;
        lastMoveTime = Date.now();

        // Aukštis skaičiuojamas tik kai realiai pajudėta ir aukščio tikslumas geras
        if (typeof altitude === 'number' && isFinite(altitude) &&
            (altitudeAccuracy == null || altitudeAccuracy <= MAX_ALT_ACCURACY)) {
            processAltitude(altitude);
        }
    } else if (typeof altitude === 'number' && isFinite(altitude) &&
               (altitudeAccuracy == null || altitudeAccuracy <= MAX_ALT_ACCURACY)) {
        processAltitude(altitude);
    }

    lastFix = { pt, t };
    pts.push(pt);
    if (currentPolyline) currentPolyline.setLatLngs(pts);
    updateStats();
}

function updateStats() {
    if (!isGpsRecording || !currentLineData) return;
    totalElapsed = Math.floor((Date.now() - startTime) / 1000);
    currentLineData.duration = totalElapsed;

    // Nejudant greitis krenta į 0
    if (Date.now() - lastMoveTime > STILL_TIMEOUT) curSpeed = 0;
    const shownSpeed = curSpeed * 3.6 < 1 ? 0 : curSpeed * 3.6;

    document.getElementById('statTime').textContent = formatTime(totalElapsed);
    document.getElementById('statDistance').textContent = formatDist(currentLineData.distance);
    document.getElementById('statSpeed').textContent = `${shownSpeed.toFixed(1)} km/h`;
    document.getElementById('statElevation').textContent = `${Math.round(currentLineData.elevationGain || 0)} m`;

    const km = currentLineData.distance / 1000;
    const hrs = totalElapsed / 3600;
    document.getElementById('statAvgSpeed').textContent = `${(hrs > 0 && km > 0 ? km / hrs : 0).toFixed(1)} km/h`;
}

async function stopGps(save = true) {
    if (!isGpsRecording) return;
    isGpsRecording = false;
    navigator.geolocation.clearWatch(watchId);
    clearInterval(timerInterval);
    releaseWakeLock();

    gpsDrawBtn.textContent = 'Pradėti GPS įrašymą';
    gpsDrawBtn.classList.remove('active');

    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
    statsPanel.classList.add('hidden');

    // Maršrutas išimamas iš „Įrašymo“ žemėlapio – jis priklauso skilčiai „Buvę“
    if (currentPolyline) { map.removeLayer(currentPolyline); currentPolyline = null; }

    const line = currentLineData;
    currentLineData = null;
    lastFix = null;

    if (!save || !line) { updateSelects(); return; }

    // Per trumpas / tuščias įrašas nesaugomas
    if (line.points.length < 2 || line.distance < 10) {
        if (line.isNew) alert('Maršrutas per trumpas, todėl neišsaugotas.');
        updateSelects();
        return;
    }

    line.duration = Math.round(totalElapsed);
    const wasNew = line.isNew;
    const ok = await isaugotiISupabase(line);
    if (!ok) alert('Nepavyko išsaugoti žygio į serverį. Patikrinkite ryšį.');
    if (wasNew && !linesData.includes(line)) linesData.push(line);
    updateSelects();

    // Perkeliame į skiltį „Buvę“ ir parodome ką tik baigtą žygį
    switchTab('history', () => {
        const poly = historyPolylineMap.get(line.id);
        if (poly && mapHistory) {
            mapHistory.fitBounds(poly.getBounds(), { padding: [60, 60], maxZoom: 17 });
            showRouteCard(line, poly);
        }
    });
}

const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
if (deleteSelectedBtn) {
    deleteSelectedBtn.onclick = async () => {
        const id = parseInt(deleteSelect.value);
        if (!id) return;

        // Jei ištrinamas dabar įrašomas maršrutas – įrašymas nutraukiamas be išsaugojimo
        if (isGpsRecording && currentLineData && currentLineData.id === id) {
            await stopGps(false);
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