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

const ICONS = {
    walk: '<circle cx="13" cy="4" r="2"/><path d="M12 8l-2 5 3 3v5M10 13l-3 2M12 8l4 3"/>',
    hike: '<path d="M3 20l6-11 4 6 3-4 5 9z"/>',
    run: '<circle cx="14" cy="4" r="2"/><path d="M13 8l-3 4 4 2 1 6M10 12l-4 1M13 8l4 3h3"/>',
    bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h5l4 8M9.5 9l2.5 8M14 6h2"/>',
    other: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'
};
const ACTIVITIES = {
    walk:  { label: 'Ėjimas',   noun: 'ėjimas',     pace: true,  maxSpeed: 8,  minStep: 5 },
    hike:  { label: 'Žygis',    noun: 'žygis',      pace: true,  maxSpeed: 8,  minStep: 5 },
    run:   { label: 'Bėgimas',  noun: 'bėgimas',    pace: true,  maxSpeed: 12, minStep: 5 },
    bike:  { label: 'Dviratis', noun: 'važiavimas', pace: false, maxSpeed: 25, minStep: 8 },
    other: { label: 'Kita',     noun: 'užsiėmimas', pace: false, maxSpeed: 30, minStep: 8 }
};
let selectedActivity = 'walk';
const iconSvg = (type, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[type] || ICONS.other}</svg>`;

function fmtSpeedFor(type, ms) {   // ms = m/s
    const a = ACTIVITIES[type] || ACTIVITIES.walk;
    if (a.pace) {
        if (!(ms > 0.3)) return '--';
        const sec = Math.round(1000 / ms);
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /km`;
    }
    return `${(ms * 3.6).toFixed(1)} km/h`;
}
// Veiklos tipas saugomas ir lokaliai, jei lentelėje nėra stulpelio „activity“
const getTypeMap = () => { try { return JSON.parse(localStorage.getItem('zygiaiTipai') || '{}'); } catch (e) { return {}; } };
const setLocalType = (id, t) => { try { const m = getTypeMap(); m[id] = t; localStorage.setItem('zygiaiTipai', JSON.stringify(m)); } catch (e) {} };

const hm = (d) => d.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
// Pradžios/pabaigos laikas saugomas esamame „date“ lauke: „2026-10-20|07:42|09:15“ (DB keisti nereikia)
const encodeDate = (l) => l.startedAt ? `${l.date}|${l.startedAt}|${l.endedAt || ''}` : l.date;
const whenText = (l) => l.startedAt ? `${l.date}, ${l.startedAt}${l.endedAt ? '–' + l.endedAt : ''}` : (l.date || '-');

let map = null;
let mapHistory = null;
const historyPolylineMap = new Map();
let historyHalo = null;

const colors = ['#1f6feb', '#0e9f6e', '#e11d48', '#f59e0b', '#8b5cf6'];
let selectedColor = colors[0];
let linesData = [];

let watchId = null, timerInterval = null, startTime = null, totalElapsed = 0;
let userMarker = null, accuracyCircle = null, isGpsRecording = false;
let currentLineData = null, currentPolyline = null;

// ---- GPS filtravimo parametrai ----
const MAX_ACCURACY = 25;        // m  – fiksavimai, blogesni už šį, ignoruojami
let MIN_STEP = 5;               // m  – priklauso nuo veiklos tipo
let MAX_SPEED = 12;             // m/s – priklauso nuo veiklos tipo
const MAX_ALT_ACCURACY = 15;    // m  – blogesnio aukščio tikslumo ignoruojame
const ELEV_THRESHOLD = 7;       // m  – kilimas skaičiuojamas tik pasikeitus aukščiui bent tiek
const STILL_TIMEOUT = 6000;     // ms – tiek be judėjimo = greitis 0

let lastAny = null;             // { t, speed } paskutinis tikslus fiksavimas (Doplerio greičiui)
let lastFix = null;             // { pt, t } paskutinis priimtas taškas
let rejectedInRow = 0;
let curSpeed = 0, lastMoveTime = 0;
let activeMs = 0, lastTick = 0, isPaused = false, autoPaused = false, autoPauseOn = true;
const AUTO_PAUSE_DELAY = 8000;  // ms be judėjimo -> automatinė pauzė
const activeNow = () => activeMs + ((isPaused || autoPaused || !lastTick) ? 0 : Date.now() - lastTick);
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
    L.control.zoom({ position: 'topright' }).addTo(m);
    return m;
}

const colorPalette = document.getElementById('colorPalette');
const customColorInput = document.getElementById('customColor');
const lineNameInput = document.getElementById('lineName');
const lineSelect = document.getElementById('lineSelect');
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
function styleGroup(g, sel) {
    g.eachLayer(l => { if (l._base) l.setStyle({ weight: l._base + (sel ? 3 : 0), opacity: sel ? 1 : 0.92 }); });
}
function clearSelection() {
    if (selectedPoly) { styleGroup(selectedPoly, false); selectedPoly = null; }
}
function closeCard() {
    infoCard.classList.add('hidden');
    document.querySelectorAll('.act-item.selected').forEach(el => el.classList.remove('selected'));
    clearSelection();
}
if (closeBtn) closeBtn.onclick = closeCard;

let cardLine = null;

// Kilometrų tarpiniai laikai (reikia taškų laiko žymų – turi tik nauji įrašai)
function computeSplits(line) {
    const p = line.points;
    if (!p || p.length < 2 || p.some(q => q.length < 3)) return [];
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + L.latLng(p[i - 1]).distanceTo(L.latLng(p[i])));
    const f = line.distance > 0 && cum[cum.length - 1] > 0 ? line.distance / cum[cum.length - 1] : 1;
    const D = cum.map(x => x * f), total = D[D.length - 1];
    const out = []; let prevT = p[0][2], k = 1, j = 1;
    while (k * 1000 <= total) {
        while (j < D.length - 1 && D[j] < k * 1000) j++;
        const r = (k * 1000 - D[j - 1]) / ((D[j] - D[j - 1]) || 1);
        const t = p[j - 1][2] + (p[j][2] - p[j - 1][2]) * r;
        out.push({ km: k, sec: t - prevT, dist: 1000 });
        prevT = t; k++;
    }
    const rem = total - (k - 1) * 1000;
    if (rem >= 100) out.push({ km: k, sec: p[p.length - 1][2] - prevT, dist: rem, partial: true });
    return out.filter(x => x.sec > 0);
}

function renderSplits(line) {
    const box = document.getElementById('card-splits');
    const sp = computeSplits(line);
    if (!sp.length) { box.innerHTML = ''; return; }
    const a = ACTIVITIES[line.activity] || ACTIVITIES.walk;
    const paces = sp.map(x => x.sec / (x.dist / 1000)), best = Math.min(...paces);
    box.innerHTML = `<div class="split-head"><span>Km</span><span>${a.pace ? 'Tempas' : 'Greitis'}</span></div>` +
        sp.map((x, i) => `<div class="split"><span class="sk">${x.partial ? (x.dist / 1000).toFixed(2) : x.km}</span>
            <span class="sbar"><i style="width:${(30 + 70 * best / paces[i]).toFixed(0)}%"></i></span>
            <b>${fmtSpeedFor(line.activity, x.dist / x.sec)}</b></div>`).join('');
}

function exportGpx(line) {
    const p = line.points || [];
    const hasT = p.length && p.every(q => q.length >= 3);
    const base = line.startedAt && /^\d{4}-\d{2}-\d{2}$/.test(line.date) ? new Date(`${line.date}T${line.startedAt}:00`) : null;
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const pts = p.map(q => `<trkpt lat="${q[0]}" lon="${q[1]}">${base && hasT ? `<time>${new Date(base.getTime() + (q[2] - p[0][2]) * 1000).toISOString()}</time>` : ''}</trkpt>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPS Žygio Žemėlapis" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(line.name)}</name><type>${line.activity}</type><trkseg>${pts}</trkseg></trk></gpx>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
    a.download = `${line.name.replace(/[^\w\-ąčęėįšųūžĄČĘĖĮŠŲŪŽ ]+/g, '').trim() || 'marsrutas'}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function showRouteCard(line, poly) {
    clearSelection();
    cardLine = line;
    if (poly) {
        selectedPoly = poly;
        styleGroup(poly, true);
        poly.bringToFront();
    }
    const a = ACTIVITIES[line.activity] || ACTIVITIES.walk;
    cardTitle.textContent = line.name;
    cardDot.style.background = line.color;
    cardDot.innerHTML = iconSvg(line.activity, 18);
    cardDuration.textContent = formatTime(line.duration || 0);
    cardDistance.textContent = formatDist(line.distance || 0);
    document.getElementById('card-speed-label').textContent = a.pace ? 'Vid. tempas' : 'Vid. greitis';
    cardSpeed.textContent = line.duration > 0 && line.distance > 0 ? fmtSpeedFor(line.activity, line.distance / line.duration) : '--';
    cardElevation.textContent = `${Math.round(line.elevationGain || 0)} m`;
    renderSplits(line);
    cardDate.textContent = `${a.label} · ${whenText(line)}`;
    document.querySelectorAll('.act-item').forEach(el => el.classList.toggle('selected', +el.dataset.id === line.id));
    const item = document.querySelector(`.act-item[data-id="${line.id}"]`);
    if (item && document.getElementById('history-list').classList.contains('open')) item.scrollIntoView({ block: 'nearest' });
    infoCard.classList.remove('hidden');
}

// „Mano veikla“ sąrašas atsiranda tik paspaudus mygtuką arba maršrutą
function setDrawer(open) {
    const list = document.getElementById('history-list');
    list.classList.toggle('open', open);
    document.getElementById('openActBtn').classList.toggle('hidden', open);
    document.documentElement.style.setProperty('--drawer-h', open ? list.offsetHeight + 'px' : '0px');
}

// Skilčių perjungimas
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

function switchTab(tabName, onReady) {
    navItems.forEach(nav => nav.classList.toggle('active', nav.getAttribute('data-tab') === tabName));
    tabContents.forEach(tab => tab.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    closeCard();
    setDrawer(false);

    if (tabName === 'record') {
        setTimeout(() => { map && map.invalidateSize(); syncPanel(); if (onReady) onReady(); }, 50);
    } else if (tabName === 'history') {
        if (!mapHistory) {
            mapHistory = createMap('map-history');
            mapHistory.setView(map.getCenter(), map.getZoom());
            mapHistory.on('click', () => { closeCard(); setDrawer(false); });
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
            date: (item.date || '-').split('|')[0],
            startedAt: (item.date || '').split('|')[1] || '',
            endedAt: (item.date || '').split('|')[2] || '',
            activity: item.activity || getTypeMap()[item.id] || 'walk'
        }));
        updateSelects();
        checkDraft();
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
        date: encodeDate(line)
    };

    const send = (p) => line.isNew
        ? supabaseClient.from('zygiai').insert([{ ...p, user_id: user.id }]).select()
        : supabaseClient.from('zygiai').update(p).eq('id', line.id).select();

    let res = await send({ ...payload, activity: line.activity });
    if (res.error && /activity/i.test(res.error.message)) {
        res = await send(payload);   // lentelėje dar nėra stulpelio „activity“
    }
    if (res.error || !res.data || !res.data.length) {
        console.error('Klaida išsaugant:', res.error && res.error.message);
        return false;
    }
    line.id = res.data[0].id;
    line.isNew = false;
    setLocalType(line.id, line.activity);
    return true;
}

async function istrintiIsSupabase(id) {
    const { error } = await supabaseClient.from('zygiai').delete().eq('id', id);
    if (error) console.error('Klaida trinant:', error.message);
}

// Įrašymo žemėlapyje piešiamas tik šiuo metu įrašomas maršrutas
function createRecordingPolyline(line) {
    return L.polyline(line.points, { color: line.color, weight: LINE_WEIGHT, opacity: 0.85 }).addTo(map);
}

const OVERLAP_CELL = 8;   // m – tinklelio ląstelė persidengimams aptikti

function renderHistoryPolylines() {
    if (!mapHistory) return;
    selectedPoly = null;
    if (historyHalo) { mapHistory.removeLayer(historyHalo); historyHalo = null; }
    historyPolylineMap.forEach(g => mapHistory.removeLayer(g));
    historyPolylineMap.clear();

    const lines = linesData.filter(l => l.points && l.points.length > 1);
    historyEmpty.classList.toggle('hidden', lines.length > 0);
    if (!lines.length) { renderHistoryList(); return; }

    // 1) Kiek skirtingų maršrutų eina per kiekvieną vietą (spalvos nesvarbios)
    const dLat = OVERLAP_CELL / 111320;
    const dLng = OVERLAP_CELL / (111320 * Math.cos(lines[0].points[0][0] * Math.PI / 180));
    const cells = new Map();
    lines.forEach(l => {
        for (let i = 0; i < l.points.length - 1; i++) {
            const a = l.points[i], b = l.points[i + 1];
            const steps = Math.max(1, Math.ceil(L.latLng(a).distanceTo(L.latLng(b)) / 4));
            for (let k = 0; k <= steps; k++) {
                const la = a[0] + (b[0] - a[0]) * k / steps, ln = a[1] + (b[1] - a[1]) * k / steps;
                const key = Math.floor(la / dLat) + ',' + Math.floor(ln / dLng);
                if (!cells.has(key)) cells.set(key, new Set());
                cells.get(key).add(l.id);
            }
        }
    });
    const countAt = (la, ln) => {
        const cx = Math.floor(la / dLat), cy = Math.floor(ln / dLng), u = new Set();
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
            const s = cells.get((cx + x) + ',' + (cy + y));
            if (s) s.forEach(id => u.add(id));
        }
        return u.size;
    };

    // 2) Kiekvienas maršrutas dalijamas į ruožus, storis pagal kartų skaičių
    const halos = [], built = [];
    lines.forEach(l => {
        const p = l.points, m = p.length - 1;
        const raw = [];
        for (let i = 0; i < m; i++) raw.push(countAt((p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2));
        const cnt = raw.map((_, i) => Math.max(raw[i - 1] || 1, raw[i], raw[i + 1] || 1));
        const layers = [];
        let start = 0;
        for (let i = 0; i < m; i++) {
            if (i === m - 1 || cnt[i + 1] !== cnt[i]) {
                const seg = p.slice(start, i + 2);
                const w = 4 + Math.min(cnt[i] - 1, 4) * 1.5;
                const pl = L.polyline(seg, { color: l.color, weight: w, opacity: 0.92, lineCap: 'round', lineJoin: 'round' });
                pl._base = w;
                layers.push(pl);
                if (cnt[i] > 1) halos.push(L.polyline(seg, { color: '#fff', weight: w + 3, opacity: 0.75, interactive: false }));
                start = i + 1;
            }
        }
        built.push({ l, layers });
    });

    historyHalo = L.featureGroup(halos).addTo(mapHistory);
    built.forEach(({ l, layers }) => {
        const g = L.featureGroup(layers).addTo(mapHistory);
        g.on('click', (e) => { L.DomEvent.stopPropagation(e); showRouteCard(l, g); });
        historyPolylineMap.set(l.id, g);
    });
    renderHistoryList();
}

function thumbSvg(pts, color) {
    if (!pts || pts.length < 2) return '';
    const step = Math.ceil(pts.length / 120);
    const p = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    const lats = p.map(x => x[0]), lngs = p.map(x => x[1]);
    const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLn = Math.min(...lngs), maxLn = Math.max(...lngs);
    const kx = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
    const w = Math.max((maxLn - minLn) * kx, 1e-9), hgt = Math.max(maxLa - minLa, 1e-9);
    const sc = Math.min(60 / w, 44 / hgt);
    const ox = (76 - w * sc) / 2, oy = (60 - hgt * sc) / 2;
    const d = p.map(x => `${(ox + (x[1] - minLn) * kx * sc).toFixed(1)},${(oy + (maxLa - x[0]) * sc).toFixed(1)}`).join(' ');
    return `<svg class="act-thumb" viewBox="0 0 76 60"><polyline points="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderHistoryList() {
    const box = document.getElementById('history-items');
    if (!box) return;
    const sum = document.getElementById('history-summary');
    if (sum) {
        const monday = new Date(); monday.setHours(0, 0, 0, 0);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        const wk = { n: 0, d: 0, t: 0 }, all = { n: 0, d: 0, t: 0 };
        linesData.forEach(l => {
            all.n++; all.d += l.distance || 0; all.t += l.duration || 0;
            const dt = new Date((l.date || '') + 'T00:00:00');
            if (!isNaN(dt) && dt >= monday) { wk.n++; wk.d += l.distance || 0; wk.t += l.duration || 0; }
        });
        const cell = (title, o) => `<div><small>${title}</small><b>${formatDist(o.d)}</b><span>${formatTime(o.t)} · ${o.n} veikl.</span></div>`;
        sum.innerHTML = cell('Ši savaitė', wk) + cell('Iš viso', all);
    }
    box.innerHTML = '';
    [...linesData].reverse().forEach(line => {
        if (!line.points || line.points.length < 2) return;
        const a = ACTIVITIES[line.activity] || ACTIVITIES.walk;
        const el = document.createElement('button');
        el.className = 'act-item';
        el.dataset.id = line.id;
        const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        el.innerHTML = `${thumbSvg(line.points, line.color)}
            <div class="act-info">
                <div class="act-title">${iconSvg(line.activity, 16)}<span>${esc(line.name)}</span></div>
                <div class="act-date">${esc(whenText(line))} · ${a.label}</div>
                <div class="act-stats">
                    <div><small>Atstumas</small><b>${formatDist(line.distance || 0)}</b></div>
                    <div><small>Trukmė</small><b>${formatTime(line.duration || 0)}</b></div>
                    <div><small>Sukilimas</small><b>${Math.round(line.elevationGain || 0)} m</b></div>
                </div>
            </div>`;
        el.onclick = () => {
            const poly = historyPolylineMap.get(line.id);
            if (!poly) return;
            mapHistory.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 17 });
            showRouteCard(line, poly);
        };
        box.appendChild(el);
    });
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

document.getElementById('openActBtn').onclick = () => setDrawer(true);
document.getElementById('closeActBtn').onclick = () => { setDrawer(false); closeCard(); };

const autoChk = document.getElementById('autoPauseChk');
try { autoChk.checked = localStorage.getItem('autoPause') !== '0'; } catch (e) {}
autoChk.onchange = () => { autoPauseOn = autoChk.checked; try { localStorage.setItem('autoPause', autoChk.checked ? '1' : '0'); } catch (e) {} };

const toggleMoreBtn = document.getElementById('toggleMoreBtn');
toggleMoreBtn.onclick = () => { document.getElementById('moreOpts').classList.toggle('hidden'); syncPanel(); };

// Veiklos tipo pasirinkimas
const activityRow = document.getElementById('activityRow');
Object.keys(ACTIVITIES).forEach(key => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act-chip' + (key === selectedActivity ? ' active' : '');
    b.innerHTML = `${iconSvg(key, 22)}<span>${ACTIVITIES[key].label}</span>`;
    b.onclick = () => {
        selectedActivity = key;
        activityRow.querySelectorAll('.act-chip').forEach(c => c.classList.remove('active'));
        b.classList.add('active');
    };
    activityRow.appendChild(b);
});

// Skydelio aukštis -> žemėlapio atribucija nepaslepiama
const recordPanel = document.getElementById('recordPanel');
function syncPanel() {
    document.documentElement.style.setProperty('--panel-h', recordPanel.offsetHeight + 'px');
}
if (window.ResizeObserver) new ResizeObserver(syncPanel).observe(recordPanel);
syncPanel();

document.querySelectorAll('input[name="lineOption"]').forEach(r => {
    r.onchange = (e) => { lineSelect.classList.toggle('hidden', e.target.value !== 'continue'); syncPanel(); };
});

function updateSelects() {
    if (!lineSelect) return;
    lineSelect.innerHTML = '';
    linesData.forEach(l => lineSelect.add(new Option(l.name, l.id)));
}

// GPS Įrašymo logika
if (gpsDrawBtn) {
    gpsDrawBtn.onclick = () => startGps();
    document.getElementById('stopBtn').onclick = () => stopGps(true);
    document.getElementById('pauseBtn').onclick = () => {
        if (!isGpsRecording) return;
        updateStats();
        if (isPaused || autoPaused) {
            isPaused = false; autoPaused = false;
            lastTick = Date.now(); lastMoveTime = Date.now(); lastFix = null; lastAny = null;
        } else {
            isPaused = true;
        }
        refreshPauseUI(); updateStats(); saveDraft();
    };
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
const GPS_OPTS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
const DRAFT_KEY = 'zygiaiDraft';

function saveDraft() {
    if (!isGpsRecording || !currentLineData) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ line: currentLineData, paused: isPaused, savedAt: Date.now() })); } catch (e) {}
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

document.addEventListener('visibilitychange', () => {
    if (!isGpsRecording) return;
    if (document.visibilityState === 'hidden') { saveDraft(); return; }
    // Grįžus į programėlę: atnaujiname ekrano užraktą, GPS stebėjimą ir laikmatį
    acquireWakeLock();
    navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(onGps, onGpsError, GPS_OPTS);
    updateStats();
});
window.addEventListener('pagehide', saveDraft);

// Nebaigto įrašymo atkūrimas (jei naršyklė užmigdė ar uždarė puslapį)
async function checkDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {}
    if (!d || !d.line) return;
    const l = d.line;
    const fresh = Date.now() - d.savedAt < 6 * 3600 * 1000;
    if (fresh && confirm(`Rastas nebaigtas įrašas „${l.name}“. Tęsti įrašymą?\n\n(Atšaukus jis bus išsaugotas toks, koks yra.)`)) {
        startGps(d);
        return;
    }
    clearDraft();
    if (l.points && l.points.length > 1 && l.distance >= 10) {
        if (l.startedAt) l.endedAt = hm(new Date(d.savedAt));
        await isaugotiISupabase(l);
        const idx = l.id != null ? linesData.findIndex(x => x.id === l.id) : -1;
        if (idx >= 0) linesData[idx] = l; else linesData.push(l);
        updateSelects();
        if (mapHistory) renderHistoryPolylines();
    }
}

const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function defaultName(type) {
    const h = new Date().getHours();
    const part = h < 5 ? 'Naktinis' : h < 12 ? 'Rytinis' : h < 18 ? 'Popietinis' : 'Vakarinis';
    return `${part} ${ACTIVITIES[type].noun}`;
}

function refreshPauseUI() {
    const act = ACTIVITIES[currentLineData && currentLineData.activity] || ACTIVITIES.walk;
    document.getElementById('liveActivity').textContent = isPaused ? 'Pristabdyta' : autoPaused ? 'Automatinė pauzė' : `${act.label} · įrašoma`;
    document.getElementById('pauseBtn').textContent = (isPaused || autoPaused) ? 'Tęsti' : 'Pauzė';
    recordPanel.classList.toggle('paused', isPaused || autoPaused);
}

function startGps(resume) {
    if (!('geolocation' in navigator)) return alert('GPS nepalaikomas');

    closeCard();
    const isContinue = document.querySelector('input[name="lineOption"]:checked').value === 'continue';

    if (resume) {
        currentLineData = resume.line;
        selectedActivity = currentLineData.activity || selectedActivity;
        totalElapsed = currentLineData.duration || 0;
    } else if (isContinue) {
        const id = parseInt(lineSelect.value);
        currentLineData = linesData.find(l => l.id === id);
        if (!currentLineData) return alert('Pasirinkite maršrutą');
        currentLineData.color = selectedColor;
        selectedActivity = currentLineData.activity || selectedActivity;
        currentLineData.elevationGain = currentLineData.elevationGain || 0;
        totalElapsed = currentLineData.duration || 0;
    } else {
        currentLineData = {
            id: null, isNew: true,
            activity: selectedActivity,
            name: lineNameInput.value.trim() || defaultName(selectedActivity),
            color: selectedColor, date: new Date().toLocaleDateString('lt-LT'), startedAt: hm(new Date()), endedAt: '',
            distance: 0, duration: 0, elevationGain: 0, points: []
        };
        totalElapsed = 0;
    }
    const act = ACTIVITIES[currentLineData.activity] || ACTIVITIES.walk;
    MAX_SPEED = act.maxSpeed; MIN_STEP = act.minStep;
    document.getElementById('lblSpeed').textContent = act.pace ? 'Tempas' : 'Greitis';
    document.getElementById('liveActivity').textContent = `${act.label} · įrašoma`;
    currentPolyline = createRecordingPolyline(currentLineData);

    // Išvalome filtrų būseną
    lastFix = null; lastAny = null; rejectedInRow = 0;
    if (resume && currentLineData.points.length) {
        lastFix = { pt: currentLineData.points[currentLineData.points.length - 1], t: resume.savedAt };
    }
    curSpeed = 0; lastMoveTime = Date.now(); isPaused = false; autoPaused = false;
    altWindow = []; smoothAlt = null; anchorAlt = null;

    watchId = navigator.geolocation.watchPosition(onGps, onGpsError, GPS_OPTS);
    activeMs = totalElapsed * 1000; lastTick = Date.now();
    autoPauseOn = document.getElementById('autoPauseChk').checked;
    if (resume) {   // laikas, praleistas užmigus ekranui, įskaičiuojamas (nebent buvo pauzė)
        isPaused = !!resume.paused;
        if (!isPaused) activeMs += Date.now() - resume.savedAt;
    }
    timerInterval = setInterval(updateStats, 1000);
    acquireWakeLock();

    isGpsRecording = true;
    document.getElementById('setupView').classList.add('hidden');
    statsPanel.classList.remove('hidden');
    refreshPauseUI();
    syncPanel();
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

    const sp = (typeof speed === 'number' && isFinite(speed) && speed >= 0) ? Math.min(speed, MAX_SPEED) : null;
    const thr = (ACTIVITIES[currentLineData.activity] || ACTIVITIES.walk).pace ? 0.6 : 1.5;   // m/s – „stovi“ riba

    if (isPaused) return;
    if (autoPaused) {
        const moving = sp !== null ? sp > thr * 1.5
            : (lastFix ? L.latLng(lastFix.pt).distanceTo(L.latLng(pt)) > Math.max(MIN_STEP, accuracy) * 1.5 : true);
        if (!moving) return;
        autoPaused = false; lastTick = Date.now(); lastMoveTime = Date.now(); lastAny = null;
        refreshPauseUI();
    }

    const pts = currentLineData.points;

    // Atstumas pagal Doplerio greitį: GPS „speed“ yra daug tikslesnis nei taškų atstumų sumavimas,
    // nes atstumus tarp „šokinėjančių“ taškų sumuojant kaupiasi zigzagų ilgis (+5–10 %)
    let dopplerOk = false;
    if (lastAny && sp !== null && lastAny.speed !== null) {
        const dtA = (t - lastAny.t) / 1000;
        if (dtA > 0 && dtA <= 30) {
            const v = (sp + lastAny.speed) / 2;
            if (v > 0.4) currentLineData.distance += v * dtA;   // žemiau 0,4 m/s – stovėjimas / triukšmas
            dopplerOk = true;
        }
    }
    lastAny = { t, speed: sp };
    if (sp !== null && sp > thr) lastMoveTime = Date.now();

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
            pts.push([lat, lng, Math.round(activeNow() / 1000)]);
            if (currentPolyline) currentPolyline.setLatLngs(pts);
            rejectedInRow = 0;
            return;
        }
        rejectedInRow = 0;

        // Tarpas (pvz. užmigo ekranas) arba GPS neduoda greičio – naudojame atstumą tarp taškų
        if (dt > 30 || !dopplerOk) currentLineData.distance += d;

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
    pts.push([lat, lng, Math.round(activeNow() / 1000)]);
    if (currentPolyline) currentPolyline.setLatLngs(pts);
    updateStats();
}

function updateStats() {
    if (!isGpsRecording || !currentLineData) return;
    const now = Date.now();
    if (!isPaused && !autoPaused) activeMs += now - lastTick;
    lastTick = now;

    // Automatinė pauzė: ilgai nejudama
    if (autoPauseOn && !isPaused && !autoPaused && lastFix && now - lastMoveTime > AUTO_PAUSE_DELAY) {
        autoPaused = true;
        activeMs = Math.max(0, activeMs - AUTO_PAUSE_DELAY);   // nejudėjimo laikas neįskaičiuojamas
        refreshPauseUI();
    }

    totalElapsed = Math.floor(activeMs / 1000);
    currentLineData.duration = totalElapsed;
    if (totalElapsed % 5 === 0) saveDraft();

    // Nejudant / pauzės metu greitis 0
    if (isPaused || autoPaused || now - lastMoveTime > STILL_TIMEOUT) curSpeed = 0;

    document.getElementById('statTime').textContent = formatTime(totalElapsed);
    document.getElementById('statDistance').textContent = formatDist(currentLineData.distance);
    document.getElementById('statSpeed').textContent = fmtSpeedFor(currentLineData.activity, curSpeed);
    document.getElementById('statElevation').textContent = `${Math.round(currentLineData.elevationGain || 0)} m`;
}

async function stopGps(save = true) {
    if (!isGpsRecording) return;
    updateStats();
    isGpsRecording = false;
    clearDraft();
    navigator.geolocation.clearWatch(watchId);
    clearInterval(timerInterval);
    releaseWakeLock();

    document.getElementById('setupView').classList.remove('hidden');
    lineNameInput.value = '';

    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
    statsPanel.classList.add('hidden');
    syncPanel();

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
    if (line.startedAt) line.endedAt = hm(new Date());
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

async function deleteLine(id) {
    if (isGpsRecording && currentLineData && currentLineData.id === id) await stopGps(false);
    linesData = linesData.filter(l => l.id !== id);
    await istrintiIsSupabase(id);
    updateSelects();
    closeCard();
    if (mapHistory) renderHistoryPolylines();
}

document.getElementById('card-gpx').onclick = () => { if (cardLine) exportGpx(cardLine); };
document.getElementById('card-rename').onclick = async () => {
    if (!cardLine) return;
    const n = prompt('Naujas pavadinimas', cardLine.name);
    if (!n || !n.trim()) return;
    cardLine.name = n.trim().slice(0, 60);
    cardTitle.textContent = cardLine.name;
    await isaugotiISupabase(cardLine);
    renderHistoryList();
    document.querySelectorAll('.act-item').forEach(el => el.classList.toggle('selected', +el.dataset.id === cardLine.id));
};
document.getElementById('card-delete').onclick = () => {
    if (cardLine && confirm(`Ištrinti „${cardLine.name}“?`)) deleteLine(cardLine.id);
};