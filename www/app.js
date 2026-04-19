// =============================================================================
// app.js — Terassille
// Sections:
//   1. State
//   2. Translations
//   3. Language
//   4. Toast
//   5. Search
//   6. Helpers (geo, sun, types)
//   7. Shadow estimation
//   8. Weather
//   9. Map
//  10. Location
//  11. Terrace loading
//  12. Markers
//  13. Filter & list
//  14. Info panel
//  15. Sun monitoring
//  16. Drink prices
//  17. Boot
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
let nearbyBuildings = [];   // loaded async after location is known


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
    loadError:   'Lataus epäonnistui',
    sunny:       'Aurinkoinen',
    leaving:     'Aurinko lähtee',
    shade:       'Varjoinen',
    rainy:       'Sateen takia varjossa',
    shadow:      'Rakennuksen varjossa',
    monitorOn:   '👁 Seuraa tätä terassia',
    monitorOff:  '✓ Seurataan – pysäytä',
    sunLabel:    'Auringon korkeuskulma',
    sunLbl:      'Aurinko',
    distLbl:     'Etäisyys',
    typeLbl:     'Tyyppi',
    sunLeaving:  'Aurinko poistumassa!',
    nextSug:      n => `Kokeile: ${n}`,
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
    loadError:   'Loading failed, try again',
    sunny:       'Sunny',
    leaving:     'Sun leaving',
    shade:       'Shaded',
    rainy:       'Rainy – no sun',
    shadow:      'Building shadow',
    monitorOn:   '👁 Monitor this terrace',
    monitorOff:  '✓ Monitoring – stop',
    sunLabel:    'Sun elevation',
    sunLbl:      'Sun',
    distLbl:     'Distance',
    typeLbl:     'Type',
    sunLeaving:  'Sun leaving soon!',
    nextSug:      n => `Try next: ${n}`,
    types: { bar: 'Bar', pub: 'Pub', cafe: 'Café', restaurant: 'Restaurant' },
    chips: ['All', '☀ Sunny', 'Bar', 'Café', 'Restaurant'],
  },
};

// Shorthand accessor
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
  const pos = SunCalc.getPosition(new Date(), lat, lon);
  const alt  = pos.altitude * (180 / Math.PI);
  // SunCalc azimuth: 0 = south. Convert to compass bearing (0 = N, 90 = E).
  const az   = ((pos.azimuth * (180 / Math.PI)) + 180 + 360) % 360;
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

// WMO weather codes
function wxInfo(code) {
  if (code === 0)   return { icon: '☀️', fi: 'Selkeää',       en: 'Clear' };
  if (code <= 2)    return { icon: '⛅', fi: 'Puolipilvistä',  en: 'Partly cloudy' };
  if (code === 3)   return { icon: '☁️', fi: 'Pilvistä',       en: 'Overcast' };
  if (code <= 49)   return { icon: '🌫️', fi: 'Sumuista',       en: 'Foggy' };
  if (code <= 57)   return { icon: '🌧️', fi: 'Tihkusadetta',   en: 'Drizzle' };
  if (code <= 65)   return { icon: '🌧️', fi: 'Sadetta',        en: 'Rain' };
  if (code <= 77)   return { icon: '🌨️', fi: 'Lumisadetta',    en: 'Snow' };
  if (code <= 82)   return { icon: '🌦️', fi: 'Sadekuuroja',    en: 'Rain showers' };
  if (code <= 86)   return { icon: '🌨️', fi: 'Lumikuuroja',    en: 'Snow showers' };
  if (code <= 99)   return { icon: '⛈️', fi: 'Ukkosta',        en: 'Thunderstorm' };
  return { icon: '🌡️', fi: 'Sää', en: 'Weather' };
}

function isRainy(code) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 99);
}

function isOvercast(code) {
  // Code 3 = overcast, 45+ = fog or precipitation
  return code >= 3;
}


// ── 7. Shadow estimation ──────────────────────────────────────────────────────
//
// After buildings are loaded from OSM, we cast a shadow ray from the sun
// direction and check if the terrace falls within any building's shadow.
//
// Shadow direction = opposite of sun azimuth.
// Shadow length per metre of building height = 1 / tan(sun altitude).

function estimateShadow(tLat, tLon, sunAlt, sunAz) {
  if (sunAlt <= 0) return true;   // sun below horizon

  const altRad    = sunAlt * Math.PI / 180;
  const shadowLen = 1 / Math.tan(altRad);   // metres per metre of height

  // Shadow falls opposite to sun
  const shadowAz = (sunAz + 180) % 360;

  const mPerLat = 111320;
  const mPerLon = 111320 * Math.cos(tLat * Math.PI / 180);

  for (const b of nearbyBuildings) {
    const maxShadowDeg = (b.height * shadowLen) / Math.min(mPerLat, mPerLon);
    if (tLat < b.minLat - maxShadowDeg || tLat > b.maxLat + maxShadowDeg) continue;
    if (tLon < b.minLon - maxShadowDeg || tLon > b.maxLon + maxShadowDeg) continue;

    for (const pt of b.pts) {
      const dLat = (pt.lat - tLat) * mPerLat;
      const dLon = (pt.lon - tLon) * mPerLon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist > 200) continue;   // only check buildings within 200 m

      // Angle from terrace to this building corner
      const angleTo = ((Math.atan2(dLon, dLat) * (180 / Math.PI)) % 360 + 360) % 360;
      const diff    = Math.abs(((angleTo - shadowAz + 180) % 360) - 180);
      if (diff > 25) continue;

      if (dist < b.height * shadowLen + 5) return true;
    }
  }
  return false;
}

async function loadNearbyBuildings(lat, lon) {
  const d    = 0.015;
  const bbox = `${lat - d},${lon - d},${lat + d},${lon + d}`;

  // First pass: buildings with explicit height/levels tags
  const q1 = `[out:json][timeout:30];(way["building"]["building:levels"](${bbox});way["building"]["height"](${bbox}););out body;>;out skel qt;`;

  try {
    const ctrl1 = new AbortController();
    const t1    = setTimeout(() => ctrl1.abort(), 25000);
    const res1  = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q1), { signal: ctrl1.signal });
    clearTimeout(t1);
    if (!res1.ok) throw new Error('HTTP ' + res1.status);

    const data1  = await res1.json();
    nearbyBuildings = [];
    const nodes1 = {};
    data1.elements.forEach(el => { if (el.type === 'node') nodes1[el.id] = { lat: el.lat, lon: el.lon }; });
    data1.elements.forEach(el => {
      if (el.type !== 'way') return;
      const h = parseFloat(el.tags?.['building:height'] || el.tags?.height || 0)
              || (parseInt(el.tags?.['building:levels'] || el.tags?.levels || 0) || 0) * 3.2;
      if (h < 4) return;
      const pts  = (el.nodes || []).map(id => nodes1[id]).filter(Boolean);
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
  } catch (e) {
    if (e.name === 'AbortError') console.warn('Building fetch timed out');
    else console.warn('Building load failed:', e);
    return;
  }

  // Second pass: all buildings, assume 13 m (4 floors) if no height tag — common in Helsinki
  if (nearbyBuildings.length < 10) {
    const q2 = `[out:json][timeout:20];way["building"](${bbox});out body;>;out skel qt;`;
    try {
      const ctrl2 = new AbortController();
      const t2    = setTimeout(() => ctrl2.abort(), 15000);
      const res2  = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q2), { signal: ctrl2.signal });
      clearTimeout(t2);
      const data2  = await res2.json();
      const nodes2 = {};
      data2.elements.forEach(el => { if (el.type === 'node') nodes2[el.id] = { lat: el.lat, lon: el.lon }; });
      data2.elements.forEach(el => {
        if (el.type !== 'way') return;
        const h    = parseFloat(el.tags?.['building:height'] || el.tags?.height || 0)
                   || (parseInt(el.tags?.['building:levels'] || el.tags?.levels || 0) || 0) * 3.2
                   || 13;
        const pts  = (el.nodes || []).map(id => nodes2[id]).filter(Boolean);
        if (pts.length < 3) return;
        const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
        const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
        const cLon = lons.reduce((a, b) => a + b, 0) / lons.length;
        const exists = nearbyBuildings.some(b => Math.abs(b.cLat - cLat) < 0.00001 && Math.abs(b.cLon - cLon) < 0.00001);
        if (!exists) nearbyBuildings.push({
          pts, height: h,
          minLat: Math.min(...lats), maxLat: Math.max(...lats),
          minLon: Math.min(...lons), maxLon: Math.max(...lons),
          cLat, cLon,
        });
      });
    } catch (e) {
      console.warn('Fallback building load failed:', e);
    }
  }

  console.log('Buildings loaded:', nearbyBuildings.length);

  // Re-render with shadow data now available
  if (nearbyBuildings.length > 0 && allTerraces.length > 0) {
    renderList();
    updateMarkerColors();
    if (selectedIndex !== null) openInfo(selectedIndex);
  }
}


// ── 8. Weather ────────────────────────────────────────────────────────────────

async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
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
    // Re-render list with updated weather conditions
    if (allTerraces.length > 0) {
      renderList();
      updateMarkerColors();
    }
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
  document.getElementById('wx-temp').textContent  = weatherData.temp + '°C';
  document.getElementById('wx-rain-fill').style.width = weatherData.rainProb + '%';
}

// Combined status: weather + sun + building shadow
function effectiveStatus(tr) {
  const sun = getSun(tr.lat, tr.lon);

  if (weatherData && isRainy(weatherData.weathercode))    return 'rainy';
  if (weatherData && isOvercast(weatherData.weathercode)) return 'shade';
  if (sun.status === 'shade')                              return 'shade';
  if (nearbyBuildings.length > 0 && estimateShadow(tr.lat, tr.lon, sun.alt, sun.az)) return 'shadow';
  if (weatherData && weatherData.weathercode >= 1)         return 'leaving';

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


// ── 9. Map ────────────────────────────────────────────────────────────────────

function initMap() {
  mapInstance = new maplibregl.Map({
    container: 'map',
    style:     'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center:    [userLon, userLat],
    zoom: 15, pitch: 50, bearing: -15,
    preserveDrawingBuffer: false,
    antialias: true,
    trackResize: true,
  });

  mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

  // Force correct canvas size after iOS WebView layout
  setTimeout(() => mapInstance.resize(), 100);
  setTimeout(() => mapInstance.resize(), 500);

  mapInstance.on('load', () => {
    add3DBuildings();
    getUserLocation();
  });
}

function add3DBuildings() {
  const style    = mapInstance.getStyle();
  const sourceId = Object.keys(style.sources || {})[0] || 'carto';

  // Find first symbol layer so we insert buildings below labels
  let firstSymbol;
  for (const layer of style.layers || []) {
    if (layer.type === 'symbol') { firstSymbol = layer.id; break; }
  }

  try {
    mapInstance.addLayer({
      id:           '3d-buildings',
      source:       sourceId,
      'source-layer': 'building',
      type:         'fill-extrusion',
      minzoom:      13,
      paint: {
        'fill-extrusion-color':   '#c8d4e0',
        'fill-extrusion-height':  ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
        'fill-extrusion-base':    ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    }, firstSymbol);
  } catch (e) {
    console.warn('3D buildings unavailable:', e);
  }
}


// ── 10. Location ──────────────────────────────────────────────────────────────

function onLocationSuccess(lat, lon) {
  userLat = lat;
  userLon = lon;
  showToast(T().located, 'success');
  mapInstance.flyTo({ center: [userLon, userLat], zoom: 15, pitch: 50, duration: 1200 });
  fetchWeather(userLat, userLon);
  loadNearbyBuildings(userLat, userLon);  // async — re-renders when done
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

  function tryHighAccuracy() {
    navigator.geolocation.getCurrentPosition(
      pos  => { if (settled) return; settled = true; onLocationSuccess(pos.coords.latitude, pos.coords.longitude); },
      ()   => { if (!settled) { settled = true; onLocationFallback(); } },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  // First: fast network/coarse location
  navigator.geolocation.getCurrentPosition(
    pos => { settled = true; onLocationSuccess(pos.coords.latitude, pos.coords.longitude); },
    ()  => { tryHighAccuracy(); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
  );

  // Also start high-accuracy in parallel after 2 s if not yet settled
  setTimeout(() => { if (!settled) tryHighAccuracy(); }, 2000);

  // Hard fallback after 25 s
  setTimeout(() => { if (!settled) { settled = true; onLocationFallback(); } }, 25000);
}


// ── 11. Terrace loading ───────────────────────────────────────────────────────

async function loadTerraces() {
  currentMarkers.forEach(m => m.remove());
  currentMarkers = [];
  allTerraces    = [];
  selectedIndex  = null;
  closeInfo();
  renderList();
  showToast(T().loading, 'info');

  const d    = 0.07;
  const bbox = `${userLat - d},${userLon - d},${userLat + d},${userLon + d}`;
  const q    = `[out:json][timeout:25];`
             + `(node["amenity"~"restaurant|bar|pub|cafe"]["outdoor_seating"="yes"](${bbox});`
             + `way["amenity"~"restaurant|bar|pub|cafe"]["outdoor_seating"="yes"](${bbox}););`
             + `out body;>;out skel qt;`;

  try {
    const res  = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    const data = await res.json();

    data.elements.forEach(el => {
      let lat, lon;
      const name    = el.tags?.name || (lang === 'fi' ? 'Terassi' : 'Terrace');
      const amenity = el.tags?.amenity || 'restaurant';

      if (el.type === 'node') {
        lat = el.lat; lon = el.lon;
      } else if (el.type === 'way' && el.geometry?.length > 2) {
        lat = el.geometry.reduce((s, g) => s + g.lat, 0) / el.geometry.length;
        lon = el.geometry.reduce((s, g) => s + g.lon, 0) / el.geometry.length;
      } else {
        return;
      }

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
    console.error(e);
    showToast(T().loadError, 'warning');
  }
}


// ── 12. Markers ───────────────────────────────────────────────────────────────

function addMarkers() {
  allTerraces.forEach((tr, i) => {
    const el = document.createElement('div');
    el.className = 'cmarker ' + effectiveStatus(tr);
    el.innerHTML = `<span class="cmarker-inner">${typeIcon(tr.type)}</span>`;
    el.addEventListener('click', e => { e.stopPropagation(); openInfo(i); });
    const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([tr.lon, tr.lat])
      .addTo(mapInstance);
    currentMarkers.push(m);
  });
}

function updateMarkerColors() {
  allTerraces.forEach((tr, i) => {
    const el = currentMarkers[i]?.getElement();
    if (el) el.className = 'cmarker ' + effectiveStatus(tr);
  });
}


// ── 13. Filter & list ─────────────────────────────────────────────────────────

function setFilter(f, el) {
  activeFilter = f;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderList();
}

function getFiltered() {
  return allTerraces.filter(tr => {
    if (searchQuery && !tr.name.toLowerCase().includes(searchQuery)) return false;
    const st = effectiveStatus(tr);
    if (activeFilter === 'sun')        return st === 'sunny';
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


// ── 14. Info panel ────────────────────────────────────────────────────────────

function openInfo(index) {
  selectedIndex = index;
  const tr  = allTerraces[index];
  const sun = getSun(tr.lat, tr.lon);
  const st  = effectiveStatus(tr);
  const typeName = T().types[tr.type] || tr.type;

  renderList();
  mapInstance.flyTo({ center: [tr.lon, tr.lat], zoom: 16, pitch: 55, duration: 700 });

  const ic = document.getElementById('info-icon');
  ic.className = st;
  ic.textContent = typeIcon(tr.type);

  document.getElementById('info-name').textContent     = tr.name;
  document.getElementById('info-subtitle').textContent = typeName + ' · ' + distStr(tr.dist);
  document.getElementById('info-sun-val').textContent  = statusLabel(st);
  document.getElementById('info-sun-val').className    = 'istat-val ' + st;
  document.getElementById('info-dist-val').textContent = distStr(tr.dist);
  document.getElementById('info-type-val').textContent = typeName;
  document.getElementById('sun-bar-label').textContent = T().sunLabel + ' ' + sun.alt + '° · ☀ ' + sun.az + '°';

  const fill = document.getElementById('sun-fill');
  fill.style.width      = sun.pct + '%';
  fill.style.background = st === 'sunny' ? '#f39c12' : st === 'leaving' ? '#e67e22' : st === 'rainy' ? '#3498db' : '#9a9ab8';

  // Weather row
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

  // Monitor button
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


// ── 15. Sun monitoring ────────────────────────────────────────────────────────

function toggleMonitoring() {
  if (selectedIndex === null) return;

  if (monitoringIndex === selectedIndex) {
    monitoringIndex = null;
    clearInterval(monitorTimer);
    openInfo(selectedIndex);
    return;
  }

  monitoringIndex = selectedIndex;
  const tr = allTerraces[selectedIndex];
  showToast('👁 ' + tr.name, 'info');
  openInfo(selectedIndex);

  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    const st = effectiveStatus(tr);
    if (st === 'leaving' || st === 'shadow') {
      const next = allTerraces.find((t2, i) => i !== monitoringIndex && effectiveStatus(t2) === 'sunny');
      showToast(T().sunLeaving + (next ? ' ' + T().nextSug(next.name) : ''), 'warning');
    }
  }, 30000);
}


// ── 16. Drink prices ──────────────────────────────────────────────────────────

const DEFAULT_DRINKS = [
  { id: 'beer3',     fi: 'Olut III',          en: 'Beer III',    size: '0.4l' },
  { id: 'beer4',     fi: 'Olut IV',           en: 'Beer IV',     size: '0.4l' },
  { id: 'cider',     fi: 'Siideri',           en: 'Cider',       size: '0.33l' },
  { id: 'wine_w',    fi: 'Valkoviini',        en: 'White wine',  size: '12cl' },
  { id: 'wine_r',    fi: 'Punaviini',         en: 'Red wine',    size: '12cl' },
  { id: 'lonkero',   fi: 'Lonkero',           en: 'Long drink',  size: '0.33l' },
  { id: 'cocktail',  fi: 'Cocktail',          en: 'Cocktail',    size: '' },
  { id: 'coffee',    fi: 'Kahvi',             en: 'Coffee',      size: '' },
  { id: 'softdrink', fi: 'Virvoitusjuoma',    en: 'Soft drink',  size: '0.33l' },
];

function venueKey(tr) {
  return (tr.name + '_' + Math.round(tr.lat * 1000) + '_' + Math.round(tr.lon * 1000))
    .replace(/\s+/g, '_');
}

function getPrices(tr) {
  try { return JSON.parse(localStorage.getItem('prices_' + venueKey(tr)) || '{}'); }
  catch (e) { return {}; }
}

function savePrices(tr, prices) {
  try { localStorage.setItem('prices_' + venueKey(tr), JSON.stringify(prices)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

function getCustomDrinks(tr) {
  try { return JSON.parse(localStorage.getItem('custom_drinks_' + venueKey(tr)) || '[]'); }
  catch (e) { return []; }
}

function saveCustomDrinks(tr, drinks) {
  try { localStorage.setItem('custom_drinks_' + venueKey(tr), JSON.stringify(drinks)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

function allDrinksForVenue(tr) {
  return [...DEFAULT_DRINKS, ...getCustomDrinks(tr)];
}

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2)   return lang === 'fi' ? 'juuri nyt'       : 'just now';
  if (m < 60)  return lang === 'fi' ? `${m} min sitten` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24)  return lang === 'fi' ? `${h} t sitten`   : `${h}h ago`;
  const d = Math.round(h / 24);
  return lang === 'fi' ? `${d} pv sitten` : `${d}d ago`;
}

function renderPriceList() {
  if (selectedIndex === null) return;
  const tr     = allTerraces[selectedIndex];
  const drinks = allDrinksForVenue(tr);
  const prices = getPrices(tr);
  const isEn   = lang === 'en';

  document.getElementById('price-title').textContent    = isEn ? 'Drink prices'  : 'Juomien hinnat';
  document.getElementById('add-drink-btn').textContent  = isEn ? '+ Add drink'   : '+ Lisää juoma';

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
      <button class="price-edit-btn" onclick="openPriceModal('${d.id}')" title="${isEn ? 'Update price' : 'Päivitä hinta'}">✏️</button>
    </div>`;
  }).join('');
}

// Modal state
let modalDrinkId = null;
let modalIsNew   = false;

function openPriceModal(drinkId) {
  if (selectedIndex === null) return;
  modalDrinkId = drinkId;
  modalIsNew   = false;
  const tr      = allTerraces[selectedIndex];
  const drink   = allDrinksForVenue(tr).find(d => d.id === drinkId);
  if (!drink) return;
  const prices   = getPrices(tr);
  const existing = prices[drinkId]?.price;
  const isEn     = lang === 'en';

  document.getElementById('price-modal-title').textContent   = isEn ? 'Update price' : 'Päivitä hinta';
  document.getElementById('price-modal-drink').textContent   = (isEn ? drink.en : drink.fi) + (drink.size ? ' (' + drink.size + ')' : '');
  document.getElementById('price-modal-input').value         = existing != null ? existing.toFixed(2) : '';
  document.getElementById('price-modal-input').placeholder   = isEn ? 'e.g. 7.50' : 'esim. 7.50';
  document.querySelector('.pm-cancel').textContent           = isEn ? 'Cancel'   : 'Peruuta';
  document.querySelector('.pm-save').textContent             = isEn ? 'Save'     : 'Tallenna';

  document.getElementById('price-modal').classList.add('show');
  setTimeout(() => document.getElementById('price-modal-input').focus(), 100);
}

function showAddDrink() {
  if (selectedIndex === null) return;
  modalIsNew   = true;
  modalDrinkId = null;
  const isEn   = lang === 'en';

  document.getElementById('price-modal-title').textContent = isEn ? 'Add drink' : 'Lisää juoma';
  document.getElementById('price-modal-drink').innerHTML   =
    `<input id="new-drink-name-fi" placeholder="Nimi suomeksi"
       style="width:100%;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:6px;outline:none">
     <input id="new-drink-name-en" placeholder="Name in English"
       style="width:100%;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:6px;outline:none">
     <input id="new-drink-size" placeholder="${isEn ? 'Size e.g. 0.4l' : 'Koko esim. 0.4l'}"
       style="width:100%;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:8px 10px;font-size:13px;outline:none">`;
  document.getElementById('price-modal-input').value       = '';
  document.getElementById('price-modal-input').placeholder = isEn ? 'Price e.g. 7.50' : 'Hinta esim. 7.50';
  document.querySelector('.pm-cancel').textContent         = isEn ? 'Cancel' : 'Peruuta';
  document.querySelector('.pm-save').textContent           = isEn ? 'Add'    : 'Lisää';

  document.getElementById('price-modal').classList.add('show');
  setTimeout(() => document.getElementById('new-drink-name-fi')?.focus(), 100);
}

function closePriceModal() {
  document.getElementById('price-modal').classList.remove('show');
  modalDrinkId = null;
  modalIsNew   = false;
}

function savePriceModal() {
  if (selectedIndex === null) { closePriceModal(); return; }
  const tr    = allTerraces[selectedIndex];
  const raw   = document.getElementById('price-modal-input').value.trim().replace(',', '.');
  const price = parseFloat(raw);

  if (modalIsNew) {
    const nameFi = document.getElementById('new-drink-name-fi')?.value.trim();
    const nameEn = document.getElementById('new-drink-name-en')?.value.trim();
    const size   = document.getElementById('new-drink-size')?.value.trim();
    if (!nameFi && !nameEn) { closePriceModal(); return; }

    const newDrink = {
      id:   'custom_' + Date.now(),
      fi:   nameFi || nameEn || 'Juoma',
      en:   nameEn || nameFi || 'Drink',
      size: size || '',
    };
    const customs = getCustomDrinks(tr);
    customs.push(newDrink);
    saveCustomDrinks(tr, customs);

    if (!isNaN(price) && price >= 0) {
      const prices = getPrices(tr);
      prices[newDrink.id] = { price, updated: Date.now() };
      savePrices(tr, prices);
    }
  } else {
    if (!modalDrinkId || isNaN(price) || price < 0) { closePriceModal(); return; }
    const prices = getPrices(tr);
    prices[modalDrinkId] = { price, updated: Date.now() };
    savePrices(tr, prices);
  }

  closePriceModal();
  renderPriceList();
}


// ── 17. Boot ──────────────────────────────────────────────────────────────────

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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-input').placeholder = T().searchPh;
  initMap();
});
