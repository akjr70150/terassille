// =============================================================================
// app.js — Terassille
// Fixes in this version:
//  - Marker deduplication (no more clusters of 20 pins on one spot)
//  - Overpass retry with fallback mirror + rate-limit handling
//  - Shadow re-render guaranteed after buildings load
//  - Web Push Notifications (works on iOS 16.4+ and Android)
//  - Supabase backend for shared drink prices
// =============================================================================


// ── 1. State ─────────────────────────────────────────────────────────────────

let lang            = 'fi';
let userLat         = 60.1699;
let userLon         = 24.9384;
let allTerraces     = [];
let currentMarkers  = [];
let mapInstance     = null;
let selectedIndex   = null;
let monitoringIndex = null;
let monitorTimer    = null;
let activeFilter    = 'all';
let searchQuery     = '';
let toastTimer      = null;
let weatherData     = null;
let nearbyBuildings = [];

// Supabase config — replace with your project URL and anon key
const SUPABASE_URL     = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON    = 'YOUR_ANON_KEY';
let   supabaseReady    = false;

// Overpass API mirrors — tried in order on failure
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];


// ── 2. Translations ───────────────────────────────────────────────────────────

const STRINGS = {
  fi: {
    searchPh:    'Hae terassia...',
    sheetTitle:  'Lähellä sinua',
    count:        n => `${n} terassia`,
    emptyState:  'Paina 📍 hakeaksesi lähellä olevia terasseja',
    noResults:   'Ei terasseja tällä suodattimella',
    locating:    'Haetaan sijaintiasi...',
    located:     'Sijainti löydetty ✓',
    loading:     'Haetaan terasseja...',
    loaded:       n => `${n} terassia löydetty ✓`,
    noTerraces:  'Ei terasseja löydetty alueella',
    locFallback: 'Sijainti ei saatavilla – käytetään Helsinkiä',
    loadError:   'Lataus epäonnistui – yritä uudelleen',
    sunny:       'Aurinkoinen',
    leaving:     'Aurinko lähtee',
    shade:       'Varjoinen',
    rainy:       'Sateen takia varjossa',
    shadow:      'Rakennuksen varjossa',
    monitorOn:   '👁 Seuraa tätä terassia',
    monitorOff:  '✓ Seurataan – pysäytä',
    sunLabel:    'Auringon korkeuskulma',
    sunLbl:      'Aurinko', distLbl: 'Etäisyys', typeLbl: 'Tyyppi',
    sunLeaving:  'Aurinko poistumassa!',
    nextSug:      n => `Kokeile: ${n}`,
    notifGranted: 'Ilmoitukset käytössä ✓',
    notifDenied:  'Ilmoitukset estetty',
    types: { bar: 'Baari', pub: 'Pubi', cafe: 'Kahvila', restaurant: 'Ravintola' },
    chips: ['Kaikki', '☀ Aurinkoinen', 'Baari', 'Kahvila', 'Ravintola'],
  },
  en: {
    searchPh:    'Search terrace...',
    sheetTitle:  'Near you',
    count:        n => `${n} terraces`,
    emptyState:  'Press 📍 to find terraces near you',
    noResults:   'No terraces match this filter',
    locating:    'Getting your location...',
    located:     'Location found ✓',
    loading:     'Loading terraces...',
    loaded:       n => `${n} terraces found ✓`,
    noTerraces:  'No terraces found in this area',
    locFallback: 'Location unavailable – using Helsinki',
    loadError:   'Loading failed – try again',
    sunny:       'Sunny',
    leaving:     'Sun leaving',
    shade:       'Shaded',
    rainy:       'Rainy – no sun',
    shadow:      'Building shadow',
    monitorOn:   '👁 Monitor this terrace',
    monitorOff:  '✓ Monitoring – stop',
    sunLabel:    'Sun elevation',
    sunLbl:      'Sun', distLbl: 'Distance', typeLbl: 'Type',
    sunLeaving:  'Sun leaving soon!',
    nextSug:      n => `Try next: ${n}`,
    notifGranted: 'Notifications enabled ✓',
    notifDenied:  'Notifications blocked',
    types: { bar: 'Bar', pub: 'Pub', cafe: 'Café', restaurant: 'Restaurant' },
    chips: ['All', '☀ Sunny', 'Bar', 'Café', 'Restaurant'],
  },
};
const T = () => STRINGS[lang];


// ── 3. Language ───────────────────────────────────────────────────────────────

function switchLanguage(l) {
  lang = l;
  document.getElementById('lp-fi').className = 'lang-pill' + (l === 'fi' ? ' active' : '');
  document.getElementById('lp-en').className = 'lang-pill' + (l === 'en' ? ' active' : '');
  document.getElementById('search-input').placeholder = T().searchPh;
  document.getElementById('sheet-title').textContent  = T().sheetTitle;
  document.querySelectorAll('#filter-row .chip').forEach((c, i) => {
    if (T().chips[i]) c.textContent = T().chips[i];
  });
  document.getElementById('lbl-sun').textContent  = T().sunLbl;
  document.getElementById('lbl-dist').textContent = T().distLbl;
  document.getElementById('lbl-type').textContent = T().typeLbl;
  updateWeatherStrip();
  renderList();
  if (selectedIndex !== null) openInfo(selectedIndex);
}


// ── 4. Toast ──────────────────────────────────────────────────────────────────

function showToast(msg, type = 'warning') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}


// ── 5. Search ─────────────────────────────────────────────────────────────────

function onSearch(val) {
  searchQuery = val.trim().toLowerCase();
  document.getElementById('search-clear').style.display = val ? 'block' : 'none';
  renderList();
}

function clearSearch() {
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  document.getElementById('search-input').focus();
  renderList();
}


// ── 6. Helpers ────────────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distStr(m) {
  return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km';
}

function getSun(lat, lon) {
  const pos    = SunCalc.getPosition(new Date(), lat, lon);
  const alt    = pos.altitude * (180 / Math.PI);
  const az     = ((pos.azimuth * (180 / Math.PI)) + 180 + 360) % 360;
  const status = alt > 12 ? 'sunny' : alt > 4 ? 'leaving' : 'shade';
  const pct    = Math.max(0, Math.min(100, ((alt + 10) / 80) * 100));
  return { alt: Math.round(alt * 10) / 10, az: Math.round(az), status, pct };
}

function typeIcon(type) {
  if (type === 'bar' || type === 'pub') return '🍺';
  if (type === 'cafe') return '☕';
  return '🍽';
}

function amenityToType(amenity) {
  if (amenity === 'bar')  return 'bar';
  if (amenity === 'pub')  return 'pub';
  if (amenity === 'cafe') return 'cafe';
  return 'restaurant';
}

function wxInfo(code) {
  if (code === 0) return { icon: '☀️', fi: 'Selkeää',       en: 'Clear' };
  if (code <= 2)  return { icon: '⛅', fi: 'Puolipilvistä',  en: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', fi: 'Pilvistä',       en: 'Overcast' };
  if (code <= 49) return { icon: '🌫️', fi: 'Sumuista',       en: 'Foggy' };
  if (code <= 57) return { icon: '🌧️', fi: 'Tihkusadetta',   en: 'Drizzle' };
  if (code <= 65) return { icon: '🌧️', fi: 'Sadetta',        en: 'Rain' };
  if (code <= 77) return { icon: '🌨️', fi: 'Lumisadetta',    en: 'Snow' };
  if (code <= 82) return { icon: '🌦️', fi: 'Sadekuuroja',    en: 'Rain showers' };
  if (code <= 86) return { icon: '🌨️', fi: 'Lumikuuroja',    en: 'Snow showers' };
  if (code <= 99) return { icon: '⛈️', fi: 'Ukkosta',        en: 'Thunderstorm' };
  return { icon: '🌡️', fi: 'Sää', en: 'Weather' };
}

function isRainy(code)    { return (code >= 51 && code <= 67) || (code >= 80 && code <= 99); }
function isOvercast(code) { return code >= 3; }


// ── 7. Shadow estimation ──────────────────────────────────────────────────────

function estimateShadow(tLat, tLon, sunAlt, sunAz) {
  if (sunAlt <= 0 || nearbyBuildings.length === 0) return false;

  const altRad    = sunAlt * Math.PI / 180;
  const shadowLen = 1 / Math.tan(altRad);
  const shadowAz  = (sunAz + 180) % 360;
  const mPerLat   = 111320;
  const mPerLon   = 111320 * Math.cos(tLat * Math.PI / 180);

  for (const b of nearbyBuildings) {
    const maxShadowDeg = (b.height * shadowLen) / Math.min(mPerLat, mPerLon);
    if (tLat < b.minLat - maxShadowDeg || tLat > b.maxLat + maxShadowDeg) continue;
    if (tLon < b.minLon - maxShadowDeg || tLon > b.maxLon + maxShadowDeg) continue;

    for (const pt of b.pts) {
      const dLat = (pt.lat - tLat) * mPerLat;
      const dLon = (pt.lon - tLon) * mPerLon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist > 250) continue;
      const angleTo = ((Math.atan2(dLon, dLat) * (180 / Math.PI)) % 360 + 360) % 360;
      if (Math.abs(((angleTo - shadowAz + 180) % 360) - 180) > 25) continue;
      if (dist < b.height * shadowLen + 5) return true;
    }
  }
  return false;
}

async function loadNearbyBuildings(lat, lon) {
  const d    = 0.015;
  const bbox = `${lat - d},${lon - d},${lat + d},${lon + d}`;
  const q    = `[out:json][timeout:30];way["building"](${bbox});out body;>;out skel qt;`;

  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 40000);
    const res  = await fetchOverpass(q, ctrl.signal);
    clearTimeout(t);
    const data = await res.json();

    nearbyBuildings = [];
    const nodes = {};
    data.elements.forEach(el => { if (el.type === 'node') nodes[el.id] = { lat: el.lat, lon: el.lon }; });
    data.elements.forEach(el => {
      if (el.type !== 'way') return;
      // Use tagged height, levels*3.2, or assume 13m (Helsinki avg ~4 floors)
      const h = parseFloat(el.tags?.['building:height'] || el.tags?.height || 0)
              || (parseInt(el.tags?.['building:levels'] || el.tags?.levels || 0) || 0) * 3.2
              || 13;
      if (h < 4) return;
      const pts  = (el.nodes || []).map(id => nodes[id]).filter(Boolean);
      if (pts.length < 3) return;
      const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
      nearbyBuildings.push({
        pts, height: h,
        minLat: Math.min(...lats), maxLat: Math.max(...lats),
        minLon: Math.min(...lons), maxLon: Math.max(...lons),
        cLat: lats.reduce((a, b) => a + b, 0) / lats.length,
        cLon: lons.reduce((a, b) => a + b, 0) / lons.length,
      });
    });

    console.log(`Buildings loaded: ${nearbyBuildings.length}`);

    // Guaranteed re-render after buildings arrive
    if (allTerraces.length > 0) {
      renderList();
      updateMarkerColors();
      if (selectedIndex !== null) openInfo(selectedIndex);
    }
  } catch (e) {
    console.warn('Building load failed:', e.name === 'AbortError' ? 'timeout' : e);
  }
}

function effectiveStatus(tr) {
  const sun = getSun(tr.lat, tr.lon);
  // Rain (51+) → rainy
  if (weatherData && isRainy(weatherData.weathercode))    return 'rainy';
  // Full overcast/fog (code 3+) → shade. Partly cloudy (1-2) does NOT affect sun status.
  if (weatherData && weatherData.weathercode >= 3)        return 'shade';
  // Sun below horizon
  if (sun.status === 'shade')                              return 'shade';
  // Building shadow
  if (estimateShadow(tr.lat, tr.lon, sun.alt, sun.az))    return 'shadow';
  // Return actual sun position status (sunny / leaving)
  return sun.status;
}

function statusLabel(status) {
  if (status === 'sunny')   return T().sunny;
  if (status === 'leaving') return T().leaving;
  if (status === 'rainy')   return T().rainy;
  if (status === 'shadow')  return T().shadow;
  if (status === 'shade' && weatherData && isOvercast(weatherData.weathercode)) {
    const wx = wxInfo(weatherData.weathercode);
    return lang === 'fi' ? wx.fi : wx.en;
  }
  return T().shade;
}


// ── 8. Overpass fetch with mirror fallback & retry ────────────────────────────

async function fetchOverpass(query, signal) {
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  let lastErr;
  for (let i = 0; i < mirrors.length; i++) {
    try {
      const url = mirrors[i] + '?data=' + encodeURIComponent(query);
      const res = await fetch(url, { signal });
      if (res.ok) return res;
      if (res.status === 429 || res.status === 503) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      console.warn('Overpass mirror ' + i + ' failed:', e.message);
      if (i < mirrors.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw lastErr || new Error('All Overpass mirrors failed');
}


// ── 9. Weather ────────────────────────────────────────────────────────────────

async function fetchWeather(lat, lon) {
  try {
    const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
               + `&current=temperature_2m,precipitation,weathercode,windspeed_10m`
               + `&hourly=precipitation_probability&timezone=auto&forecast_days=1`;
    const res  = await fetch(url);
    const data = await res.json();
    weatherData = {
      temp:        Math.round(data.current.temperature_2m),
      precip:      data.current.precipitation,
      weathercode: data.current.weathercode,
      wind:        Math.round(data.current.windspeed_10m),
      rainProb:    data.hourly?.precipitation_probability
                   ? Math.round(data.hourly.precipitation_probability.slice(0, 3).reduce((a, b) => a + b, 0) / 3)
                   : 0,
    };
    updateWeatherStrip();
    if (allTerraces.length > 0) { renderList(); updateMarkerColors(); }
  } catch (e) {
    console.warn('Weather fetch failed:', e);
  }
}

function updateWeatherStrip() {
  if (!weatherData) return;
  const strip = document.getElementById('weather-strip');
  strip.classList.add('show');
  const wx = wxInfo(weatherData.weathercode);
  document.getElementById('wx-icon').textContent = wx.icon;
  document.getElementById('wx-text').textContent =
    (lang === 'fi' ? wx.fi : wx.en)
    + (weatherData.wind > 0 ? ' · ' + weatherData.wind + ' km/h' : '')
    + (weatherData.rainProb > 20 ? ' · ' + weatherData.rainProb + '% ' + (lang === 'fi' ? 'sadetta' : 'rain') : '');
  document.getElementById('wx-temp').textContent         = weatherData.temp + '°C';
  document.getElementById('wx-rain-fill').style.width    = weatherData.rainProb + '%';
}


// ── 10. Map ───────────────────────────────────────────────────────────────────

function initMap() {
  // Ensure map container has dimensions before init
  const container = document.getElementById('map');
  if (!container || container.offsetHeight === 0) {
    console.warn('Map container not ready, retrying...');
    setTimeout(initMap, 200);
    return;
  }

  try {
    mapInstance = new maplibregl.Map({
      container:  'map',
      style:      'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center:     [userLon, userLat],
      zoom: 14, pitch: 0, bearing: 0,
      trackResize: true,
      attributionControl: false,
    });

    mapInstance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Force resize after layout
    setTimeout(() => { if (mapInstance) mapInstance.resize(); }, 100);
    setTimeout(() => { if (mapInstance) mapInstance.resize(); }, 800);

    mapInstance.on('load', () => {
      console.log('Map loaded OK');
      add3DBuildings();
      setTimeout(() => getUserLocation(), 300);
    });

    mapInstance.on('error', (e) => {
      console.warn('MapLibre error:', JSON.stringify(e));
    });

  } catch (e) {
    console.error('Map init failed:', e);
  }
}

function add3DBuildings() {
  const style    = mapInstance.getStyle();
  const sourceId = Object.keys(style.sources || {})[0] || 'carto';
  let firstSymbol;
  for (const layer of style.layers || []) {
    if (layer.type === 'symbol') { firstSymbol = layer.id; break; }
  }
  try {
    mapInstance.addLayer({
      id: '3d-buildings', source: sourceId, 'source-layer': 'building',
      type: 'fill-extrusion', minzoom: 13,
      paint: {
        'fill-extrusion-color':   '#c8d4e0',
        'fill-extrusion-height':  ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
        'fill-extrusion-base':    ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    }, firstSymbol);
  } catch (e) { console.warn('3D buildings unavailable:', e); }
}


// ── 11. Location ──────────────────────────────────────────────────────────────

function onLocationSuccess(lat, lon) {
  userLat = lat; userLon = lon;
  showToast(T().located, 'success');
  if (mapInstance) {
    mapInstance.flyTo({ center: [userLon, userLat], zoom: 14, duration: 1200 });
  }
  fetchWeather(userLat, userLon);
  loadNearbyBuildings(userLat, userLon);
  loadTerraces();
}

function onLocationFallback() {
  showToast(T().locFallback, 'warning');
  fetchWeather(userLat, userLon);
  loadNearbyBuildings(userLat, userLon);
  loadTerraces();
}

function getUserLocation() {
  showToast(T().locating, 'info');
  if (!navigator.geolocation) { onLocationFallback(); return; }

  let settled = false;

  function done(lat, lon) {
    if (settled) return;
    settled = true;
    onLocationSuccess(lat, lon);
  }

  function fail() {
    if (settled) return;
    settled = true;
    onLocationFallback();
  }

  // Strategy 1: watchPosition — keeps trying and gives best available fix.
  // On Android/iOS this is the most reliable approach.
  let watchId = null;
  let gotCoarse = false;

  watchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      console.log('Location fix:', lat, lon, 'accuracy:', accuracy + 'm');

      // Accept any fix under 500m accuracy, or immediately accept if high accuracy
      if (accuracy < 500 || accuracy < 100) {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        done(lat, lon);
      } else if (!gotCoarse) {
        // Got a rough fix — use it but keep watching for better
        gotCoarse = true;
        userLat = lat; userLon = lon;
      }
    },
    err => {
      console.warn('watchPosition error:', err.code, err.message);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      // Try one-shot high accuracy as fallback
      navigator.geolocation.getCurrentPosition(
        pos => done(pos.coords.latitude, pos.coords.longitude),
        ()  => {
          // If we got a coarse fix earlier, use that
          if (gotCoarse) done(userLat, userLon);
          else fail();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
  );

  // Hard fallback: if nothing after 20s, use coarse or Helsinki default
  setTimeout(() => {
    if (!settled) {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (gotCoarse) done(userLat, userLon);
      else fail();
    }
  }, 20000);
}


// ── 12. Terrace loading with deduplication ────────────────────────────────────

async function loadTerraces() {
  currentMarkers.forEach(m => m.remove());
  currentMarkers = []; allTerraces = []; selectedIndex = null;
  closeInfo(); renderList();
  showToast(T().loading, 'info');

  const d    = 0.07;
  const bbox = `${userLat - d},${userLon - d},${userLat + d},${userLon + d}`;
  const q    = `[out:json][timeout:25];`
             + `(node["amenity"~"restaurant|bar|pub|cafe"]["outdoor_seating"="yes"](${bbox});`
             + `way["amenity"~"restaurant|bar|pub|cafe"]["outdoor_seating"="yes"](${bbox}););`
             + `out body;>;out skel qt;`;

  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 40000);
    const res  = await fetchOverpass(q, ctrl.signal);
    clearTimeout(t);
    const data = await res.json();

    // Build node lookup for way centroids
    const nodeMap = {};
    data.elements.forEach(el => { if (el.type === 'node') nodeMap[el.id] = { lat: el.lat, lon: el.lon }; });

    // Deduplicate: group by (name + rounded coords) — OSM often has node + way for same venue
    const seen = new Map();

    data.elements.forEach(el => {
      let lat, lon;
      const name    = el.tags?.name || (lang === 'fi' ? 'Terassi' : 'Terrace');
      const amenity = el.tags?.amenity || 'restaurant';

      if (el.type === 'node') {
        lat = el.lat; lon = el.lon;
      } else if (el.type === 'way') {
        // Use explicit geometry if available, else look up node coords
        const pts = el.geometry
          ? el.geometry
          : (el.nodes || []).map(id => nodeMap[id]).filter(Boolean);
        if (pts.length < 2) return;
        lat = pts.reduce((s, g) => s + g.lat, 0) / pts.length;
        lon = pts.reduce((s, g) => s + g.lon, 0) / pts.length;
      } else {
        return;
      }

      // Deduplicate by name + coords rounded to ~1m grid
      // Also catch same venue with slightly different coords (node vs way centroid)
      const key = `${name}_${Math.round(lat * 10000)}_${Math.round(lon * 10000)}`;
      // Secondary check: if a venue with same name is already within 50m, skip
      const alreadyNearby = allTerraces.some(ex =>
        ex.name === name && haversine(ex.lat, ex.lon, lat, lon) < 50
      );
      if (seen.has(key) || alreadyNearby) return;
      seen.set(key, true);

      const dist = haversine(userLat, userLon, lat, lon);
      const type = amenityToType(amenity);
      allTerraces.push({ name, lat, lon, dist, type });
    });

    allTerraces.sort((a, b) => a.dist - b.dist);

    if (allTerraces.length === 0) {
      showToast(T().noTerraces, 'warning');
    } else {
      showToast(T().loaded(allTerraces.length), 'success');
      addMarkers();
    }
    renderList();
  } catch (e) {
    console.error('loadTerraces failed:', e);
    showToast(T().loadError, 'warning');
  }
}


// ── 13. Markers ───────────────────────────────────────────────────────────────

function addMarkers() {
  allTerraces.forEach((tr, i) => {
    const el = document.createElement('div');
    el.className = 'cmarker ' + effectiveStatus(tr);
    el.innerHTML = `<span class="cmarker-inner">${typeIcon(tr.type)}</span>`;
    el.addEventListener('click', e => { e.stopPropagation(); openInfo(i); });
    const m = new maplibregl.Marker({
      element:           el,
      anchor:            'bottom',
      pitchAlignment:    'map',     // stays on ground plane when map is tilted
      rotationAlignment: 'map',     // rotates with map bearing
    }).setLngLat([tr.lon, tr.lat]).addTo(mapInstance);
    currentMarkers.push(m);
  });
}

function updateMarkerColors() {
  allTerraces.forEach((tr, i) => {
    const el = currentMarkers[i]?.getElement();
    if (el) el.className = 'cmarker ' + effectiveStatus(tr);
  });
}


// ── 14. Filter & list ─────────────────────────────────────────────────────────

function setFilter(f, el) {
  activeFilter = f;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderList();
}

function getFiltered() {
  return allTerraces.filter(tr => {
    if (searchQuery && !tr.name.toLowerCase().includes(searchQuery)) return false;
    if (activeFilter === 'sun')        return effectiveStatus(tr) === 'sunny';
    if (activeFilter === 'bar')        return tr.type === 'bar' || tr.type === 'pub';
    if (activeFilter === 'cafe')       return tr.type === 'cafe';
    if (activeFilter === 'restaurant') return tr.type === 'restaurant';
    return true;
  });
}

function renderList() {
  const list = document.getElementById('terrace-list');
  const rows = getFiltered();
  document.getElementById('sheet-count').textContent = T().count(rows.length);

  if (allTerraces.length === 0) {
    list.innerHTML = `<div id="empty-state">${T().emptyState}</div>`;
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = `<div id="empty-state">${T().noResults}</div>`;
    return;
  }

  list.innerHTML = rows.map(tr => {
    const gi  = allTerraces.indexOf(tr);
    const sel = selectedIndex === gi;
    const st  = effectiveStatus(tr);
    const wx  = weatherData ? wxInfo(weatherData.weathercode) : null;
    const metaWeather = wx && st === 'rainy'
      ? `<span class="meta-dot"></span><span>${lang === 'fi' ? wx.fi : wx.en}</span>` : '';
    return `<div class="t-row${sel ? ' selected' : ''}" onclick="openInfo(${gi})">
      <div class="t-icon ${st}">${typeIcon(tr.type)}</div>
      <div class="t-info">
        <div class="t-name">${tr.name}</div>
        <div class="t-meta">
          <span>${T().types[tr.type] || tr.type}</span>
          <span class="meta-dot"></span>
          <span>${distStr(tr.dist)}</span>
          ${metaWeather}
        </div>
      </div>
      <div class="t-right">
        <span class="sun-badge ${st}">${statusLabel(st)}</span>
        <span class="t-dist">${distStr(tr.dist)}</span>
      </div>
    </div>`;
  }).join('');
}


// ── 15. Info panel ────────────────────────────────────────────────────────────

function openInfo(index) {
  selectedIndex = index;
  const tr       = allTerraces[index];
  const sun      = getSun(tr.lat, tr.lon);
  const st       = effectiveStatus(tr);
  const typeName = T().types[tr.type] || tr.type;

  renderList();
  if (mapInstance) mapInstance.flyTo({ center: [tr.lon, tr.lat], zoom: 16, duration: 700 });

  const ic = document.getElementById('info-icon');
  ic.className = st; ic.textContent = typeIcon(tr.type);

  document.getElementById('info-name').textContent     = tr.name;
  document.getElementById('info-subtitle').textContent = typeName + ' · ' + distStr(tr.dist);
  document.getElementById('info-sun-val').textContent  = statusLabel(st);
  document.getElementById('info-sun-val').className    = 'istat-val ' + st;
  document.getElementById('info-dist-val').textContent = distStr(tr.dist);
  document.getElementById('info-type-val').textContent = typeName;
  document.getElementById('sun-bar-label').textContent = T().sunLabel + ' ' + sun.alt + '° · ☀ ' + sun.az + '°';

  const fill = document.getElementById('sun-fill');
  fill.style.width      = sun.pct + '%';
  fill.style.background = { sunny: '#f39c12', leaving: '#e67e22', rainy: '#3498db' }[st] || '#9a9ab8';

  const wxRow = document.getElementById('info-weather-row');
  if (weatherData) {
    const wx = wxInfo(weatherData.weathercode);
    wxRow.classList.add('show');
    document.getElementById('iw-icon').textContent = wx.icon;
    document.getElementById('iw-desc').textContent = (lang === 'fi' ? wx.fi : wx.en)
      + ' · ' + weatherData.precip + 'mm · ' + weatherData.wind + ' km/h';
    document.getElementById('iw-temp').textContent = weatherData.temp + '°C';
  } else {
    wxRow.classList.remove('show');
  }

  const isOn = monitoringIndex === index;
  const btn  = document.getElementById('monitor-btn');
  btn.textContent = isOn ? T().monitorOff : T().monitorOn;
  btn.className   = isOn ? 'on' : '';

  document.getElementById('info-panel').classList.add('open');
  renderPriceList();
}

function closeInfo() {
  document.getElementById('info-panel').classList.remove('open');
  selectedIndex = null;
  renderList();
}


// ── 16. Notifications (Web Push — works on iOS 16.4+ PWA, Android Chrome) ────
//
// Strategy:
//  1. Ask for permission when user first taps monitor
//  2. Use the Web Notifications API directly (no Capacitor plugin needed)
//  3. On iOS: must be installed as a PWA (Add to Home Screen) for notifications to work
//  4. Show in-app toast as fallback when notifications aren't available

let notifPermission = 'default';

async function requestNotifPermission() {
  try {
    if (typeof Notification === 'undefined') return false;
    if (notifPermission === 'granted') return true;
    notifPermission = await Notification.requestPermission();
    if (notifPermission === 'granted') {
      showToast(T().notifGranted, 'success');
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function sendNotification(title, body) {
  try {
    if (typeof Notification !== 'undefined' && notifPermission === 'granted') {
      new Notification(title, { body, icon: 'icons/icon-192.png' });
      return;
    }
  } catch (e) {}
  showToast(title + ' — ' + body, 'warning');
}


// ── 17. Sun monitoring ────────────────────────────────────────────────────────

async function toggleMonitoring() {
  if (selectedIndex === null) return;

  if (monitoringIndex === selectedIndex) {
    monitoringIndex = null;
    clearInterval(monitorTimer);
    openInfo(selectedIndex);
    return;
  }

  // Request notification permission on first monitor tap
  await requestNotifPermission();

  monitoringIndex = selectedIndex;
  const tr = allTerraces[selectedIndex];
  showToast('👁 ' + tr.name, 'info');
  openInfo(selectedIndex);

  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    const st = effectiveStatus(tr);
    if (st === 'leaving' || st === 'shadow') {
      const next = allTerraces.find((t2, i) => i !== monitoringIndex && effectiveStatus(t2) === 'sunny');
      const body = next ? T().nextSug(next.name) : (lang === 'fi' ? 'Ei aurinkoista terassia lähellä' : 'No sunny terrace nearby');
      sendNotification(
        lang === 'fi' ? 'Terassille ☀️' : 'Terassille ☀️',
        `${tr.name}: ${T().sunLeaving} ${body}`
      );
    }
  }, 30000);
}


// ── 18. Drink prices (localStorage + Supabase backend) ───────────────────────

const DEFAULT_DRINKS = [
  { id: 'beer3',      fi: 'Olut III',       en: 'Beer III',    size: '0.4l' },
  { id: 'beer4',      fi: 'Olut IV',        en: 'Beer IV',     size: '0.4l' },
  { id: 'cider',      fi: 'Siideri',        en: 'Cider',       size: '0.33l' },
  { id: 'wine_w',     fi: 'Valkoviini',     en: 'White wine',  size: '12cl' },
  { id: 'wine_r',     fi: 'Punaviini',      en: 'Red wine',    size: '12cl' },
  { id: 'lonkero',    fi: 'Lonkero',        en: 'Long drink',  size: '0.33l' },
  { id: 'cocktail',   fi: 'Cocktail',       en: 'Cocktail',    size: '' },
  { id: 'coffee',     fi: 'Kahvi',          en: 'Coffee',      size: '' },
  { id: 'softdrink',  fi: 'Virvoitusjuoma', en: 'Soft drink',  size: '0.33l' },
];

function venueKey(tr) {
  return (tr.name + '_' + Math.round(tr.lat * 10000) + '_' + Math.round(tr.lon * 10000))
    .replace(/[^a-zA-Z0-9_]/g, '_');
}

// Local prices (localStorage) — always available offline
function getLocalPrices(tr) {
  try { return JSON.parse(localStorage.getItem('prices_' + venueKey(tr)) || '{}'); }
  catch (e) { return {}; }
}
function saveLocalPrices(tr, prices) {
  try { localStorage.setItem('prices_' + venueKey(tr), JSON.stringify(prices)); }
  catch (e) {}
}
function getCustomDrinks(tr) {
  try { return JSON.parse(localStorage.getItem('custom_drinks_' + venueKey(tr)) || '[]'); }
  catch (e) { return []; }
}
function saveCustomDrinks(tr, drinks) {
  try { localStorage.setItem('custom_drinks_' + venueKey(tr), JSON.stringify(drinks)); }
  catch (e) {}
}
function allDrinksForVenue(tr) { return [...DEFAULT_DRINKS, ...getCustomDrinks(tr)]; }

// Supabase sync — push price update to backend
async function syncPriceToBackend(tr, drinkId, price) {
  if (!supabaseReady) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        venue_key:  venueKey(tr),
        venue_name: tr.name,
        lat:        tr.lat,
        lon:        tr.lon,
        drink_id:   drinkId,
        price:      price,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('Supabase sync failed:', e);
  }
}

// Load prices from Supabase — merges with local prices, remote wins on conflict
async function loadPricesFromBackend(tr) {
  if (!supabaseReady) return;
  try {
    const res  = await fetch(
      `${SUPABASE_URL}/rest/v1/prices?venue_key=eq.${encodeURIComponent(venueKey(tr))}&select=drink_id,price,updated_at`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return;
    const local = getLocalPrices(tr);
    rows.forEach(row => {
      local[row.drink_id] = { price: row.price, updated: new Date(row.updated_at).getTime() };
    });
    saveLocalPrices(tr, local);
    renderPriceList();
  } catch (e) {
    console.warn('Backend price load failed:', e);
  }
}

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2)  return lang === 'fi' ? 'juuri nyt' : 'just now';
  if (m < 60) return lang === 'fi' ? `${m} min sitten` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return lang === 'fi' ? `${h} t sitten` : `${h}h ago`;
  return lang === 'fi' ? `${Math.round(h / 24)} pv sitten` : `${Math.round(h / 24)}d ago`;
}

function renderPriceList() {
  if (selectedIndex === null) return;
  const tr     = allTerraces[selectedIndex];
  const drinks = allDrinksForVenue(tr);
  const prices = getLocalPrices(tr);
  const isEn   = lang === 'en';

  document.getElementById('price-title').textContent   = isEn ? 'Drink prices' : 'Juomien hinnat';
  document.getElementById('add-drink-btn').textContent = isEn ? '+ Add drink'  : '+ Lisää juoma';

  document.getElementById('price-list').innerHTML = drinks.map(d => {
    const p        = prices[d.id];
    const priceStr = p?.price != null ? p.price.toFixed(2) + ' €' : null;
    const ago      = p?.updated ? timeAgo(p.updated) : '';
    return `<div class="price-row">
      <div style="flex:1;min-width:0">
        <div class="price-drink-name">
          ${isEn ? d.en : d.fi}
          ${d.size ? `<span style="color:rgba(0,0,0,0.3);font-size:11px"> ${d.size}</span>` : ''}
        </div>
        ${ago ? `<div class="price-updated">${isEn ? 'Updated' : 'Päivitetty'}: ${ago}</div>` : ''}
      </div>
      <div class="${priceStr ? 'price-val' : 'price-val unknown'}">
        ${priceStr || (isEn ? '— tap to add' : '— lisää hinta')}
      </div>
      <button class="price-edit-btn" onclick="openPriceModal('${d.id}')" title="✏️">✏️</button>
    </div>`;
  }).join('');
}

let modalDrinkId = null, modalIsNew = false;

function openPriceModal(drinkId) {
  if (selectedIndex === null) return;
  modalDrinkId = drinkId; modalIsNew = false;
  const tr      = allTerraces[selectedIndex];
  const drink   = allDrinksForVenue(tr).find(d => d.id === drinkId);
  if (!drink) return;
  const existing = getLocalPrices(tr)[drinkId]?.price;
  const isEn     = lang === 'en';

  document.getElementById('price-modal-title').textContent = isEn ? 'Update price' : 'Päivitä hinta';
  document.getElementById('price-modal-drink').textContent = (isEn ? drink.en : drink.fi) + (drink.size ? ' (' + drink.size + ')' : '');
  document.getElementById('price-modal-input').value       = existing != null ? existing.toFixed(2) : '';
  document.getElementById('price-modal-input').placeholder = isEn ? 'e.g. 7.50' : 'esim. 7.50';
  document.querySelector('.pm-cancel').textContent         = isEn ? 'Cancel'  : 'Peruuta';
  document.querySelector('.pm-save').textContent           = isEn ? 'Save'    : 'Tallenna';
  document.getElementById('price-modal').classList.add('show');
  setTimeout(() => document.getElementById('price-modal-input').focus(), 100);
}

function showAddDrink() {
  if (selectedIndex === null) return;
  modalIsNew = true; modalDrinkId = null;
  const isEn = lang === 'en';
  document.getElementById('price-modal-title').textContent = isEn ? 'Add drink' : 'Lisää juoma';
  document.getElementById('price-modal-drink').innerHTML =
    `<input id="nfi" placeholder="Nimi suomeksi" style="width:100%;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:6px;outline:none">
     <input id="nen" placeholder="Name in English" style="width:100%;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:6px;outline:none">
     <input id="nsz" placeholder="${isEn ? 'Size e.g. 0.4l' : 'Koko esim. 0.4l'}" style="width:100%;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:8px 10px;font-size:13px;outline:none">`;
  document.getElementById('price-modal-input').value = '';
  document.getElementById('price-modal-input').placeholder = isEn ? 'Price e.g. 7.50' : 'Hinta esim. 7.50';
  document.querySelector('.pm-cancel').textContent = isEn ? 'Cancel' : 'Peruuta';
  document.querySelector('.pm-save').textContent   = isEn ? 'Add'    : 'Lisää';
  document.getElementById('price-modal').classList.add('show');
  setTimeout(() => document.getElementById('nfi')?.focus(), 100);
}

function closePriceModal() {
  document.getElementById('price-modal').classList.remove('show');
  modalDrinkId = null; modalIsNew = false;
}

async function savePriceModal() {
  if (selectedIndex === null) { closePriceModal(); return; }
  const tr    = allTerraces[selectedIndex];
  const price = parseFloat(document.getElementById('price-modal-input').value.trim().replace(',', '.'));

  if (modalIsNew) {
    const fi = document.getElementById('nfi')?.value.trim();
    const en = document.getElementById('nen')?.value.trim();
    const sz = document.getElementById('nsz')?.value.trim();
    if (!fi && !en) { closePriceModal(); return; }
    const newDrink = { id: 'custom_' + Date.now(), fi: fi || en || 'Juoma', en: en || fi || 'Drink', size: sz || '' };
    const customs  = getCustomDrinks(tr);
    customs.push(newDrink);
    saveCustomDrinks(tr, customs);
    if (!isNaN(price) && price >= 0) {
      const prices = getLocalPrices(tr);
      prices[newDrink.id] = { price, updated: Date.now() };
      saveLocalPrices(tr, prices);
      syncPriceToBackend(tr, newDrink.id, price);
    }
  } else {
    if (!modalDrinkId || isNaN(price) || price < 0) { closePriceModal(); return; }
    const prices = getLocalPrices(tr);
    prices[modalDrinkId] = { price, updated: Date.now() };
    saveLocalPrices(tr, prices);
    syncPriceToBackend(tr, modalDrinkId, price);
  }

  closePriceModal();
  renderPriceList();
}


// ── 19. Boot ──────────────────────────────────────────────────────────────────

// ── Draggable bottom sheet ────────────────────────────────────────────────────

(function() {
  let dragging = false, startY = 0, startH = 0;

  function getSheet() { return document.getElementById('bottom-sheet'); }

  function clamp(h) {
    return Math.max(110, Math.min(window.innerHeight * 0.85, h));
  }

  function onStart(clientY) {
    const sheet = getSheet();
    dragging = true;
    startY   = clientY;
    startH   = sheet.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
  }

  function onMove(clientY) {
    if (!dragging) return;
    const delta  = startY - clientY;   // drag up = positive = taller
    const newH   = clamp(startH + delta);
    document.documentElement.style.setProperty('--sheet-height', newH + 'px');
    if (mapInstance) mapInstance.resize();
  }

  function onEnd() {
    dragging = false;
    document.body.style.userSelect = '';
    // Snap to nearest of three heights: compact ~110px, medium ~48vh, tall ~75vh
    const sheet  = getSheet();
    const h      = sheet.getBoundingClientRect().height;
    const vh     = window.innerHeight;
    const snaps  = [110, vh * 0.35, vh * 0.65];
    const closest = snaps.reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
    document.documentElement.style.setProperty('--sheet-height', closest + 'px');
    sheet.style.transition = 'height 0.25s cubic-bezier(0.32,0.72,0,1)';
    setTimeout(() => { sheet.style.transition = ''; }, 260);
    if (mapInstance) setTimeout(() => mapInstance.resize(), 260);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('sheet-handle');
    if (!handle) return;

    // Mouse
    handle.addEventListener('mousedown',  e => { e.preventDefault(); onStart(e.clientY); });
    document.addEventListener('mousemove', e => onMove(e.clientY));
    document.addEventListener('mouseup',   () => onEnd());

    // Touch
    handle.addEventListener('touchstart',  e => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
    document.addEventListener('touchmove',  e => { if (dragging) { e.preventDefault(); onMove(e.touches[0].clientY); } }, { passive: false });
    document.addEventListener('touchend',   () => onEnd());
  });
})();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mapInstance) mapInstance.resize();
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => { if (mapInstance) mapInstance.resize(); }, 300);
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('price-modal').classList.contains('show')) return;
  if (e.key === 'Enter')  savePriceModal();
  if (e.key === 'Escape') closePriceModal();
});

// Check if Supabase is configured (not placeholder values)
supabaseReady = SUPABASE_URL !== 'https://YOUR_PROJECT.supabase.co';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-input').placeholder = T().searchPh;
  initMap();
});
