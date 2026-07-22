const TLE_GROUPS = {
  focused: ["stations", "visual", "weather", "amateur", "science", "education", "cubesat"],
  weather: ["weather"],
  radio: ["amateur", "satnogs"],
  earth: ["weather", "resource", "sarsat", "dmc", "argos", "planet", "spire"],
  active: ["active"]
};

const CACHE_MS = 2 * 60 * 60 * 1000;
const LIST_STEP = 80;
const PASS_STEP_SECONDS = 30;
const POINT_STEP_SECONDS = 20;
const EARTH_RADIUS_KM = 6371;
const SATELLITE_CACHE_KEY = "sa-trackr:tles";
const FAVORITES_KEY = "sa-trackr:favorites";
const LOCATION_KEY = "sa-trackr:location";
const SOURCE_KEY = "sa-trackr:source";
const ELEVATION_KEY = "sa-trackr:min-elevation";

const state = {
  satellites: [],
  filtered: [],
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")),
  selected: null,
  selectedPass: null,
  passes: [],
  listMode: "all",
  previousListMode: "all",
  visibleCount: LIST_STEP,
  source: localStorage.getItem(SOURCE_KEY) || "focused",
  rangeStart: startOfLocalDay(new Date()),
  rangeDays: 2,
  minElevation: Number(localStorage.getItem(ELEVATION_KEY) || "30"),
  observer: loadObserver(),
  locationMap: null,
  locationMarker: null,
  trackMap: null,
  satelliteMarker: null,
  trackLayers: [],
  footprintLayer: null,
  mapTimer: null,
  skyTimer: null,
  toastTimer: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindElements();
  bindEvents();
  setupIcons();
  setInputsFromState();
  setView("list");
  registerServiceWorker();
  initLocationMap();
  loadCatalog(false);
}

function bindElements() {
  [
    "backButton",
    "refreshButton",
    "mapButton",
    "favoritesToggle",
    "statusLine",
    "cacheStamp",
    "latitudeInput",
    "longitudeInput",
    "altitudeInput",
    "useDeviceButton",
    "sourceSelect",
    "searchInput",
    "listCount",
    "listTitle",
    "listHint",
    "satelliteList",
    "loadMoreButton",
    "passesView",
    "listView",
    "skyView",
    "mapView",
    "selectedNorad",
    "selectedName",
    "selectedFavorite",
    "minElevationInput",
    "minElevationRange",
    "rangeLabelTop",
    "rangeLabelBottom",
    "passesBody",
    "passesEmpty",
    "skyDate",
    "skyTitle",
    "countdownText",
    "skyPath",
    "currentSkyDot",
    "skyMeta",
    "skyPlot",
    "mapSatelliteLabel",
    "mapTitle",
    "trackMap",
    "locationMap",
    "mapClock",
    "mapDetails",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadCatalog(true));
  els.favoritesToggle.addEventListener("click", toggleFavoritesView);
  els.backButton.addEventListener("click", goBack);
  els.mapButton.addEventListener("click", openMapView);
  els.loadMoreButton.addEventListener("click", () => {
    state.visibleCount += LIST_STEP;
    renderSatelliteList();
  });
  els.searchInput.addEventListener("input", () => {
    state.visibleCount = LIST_STEP;
    renderSatelliteList();
  });
  els.sourceSelect.addEventListener("change", () => {
    state.source = els.sourceSelect.value;
    localStorage.setItem(SOURCE_KEY, state.source);
    state.visibleCount = LIST_STEP;
    loadCatalog(false);
  });
  [els.latitudeInput, els.longitudeInput, els.altitudeInput].forEach((input) => {
    input.addEventListener("change", updateObserverFromInputs);
  });
  els.useDeviceButton.addEventListener("click", useDeviceLocation);
  els.selectedFavorite.addEventListener("click", () => {
    if (state.selected) {
      toggleFavorite(state.selected.id, state.selected.name);
      updateSelectedFavorite();
      renderSatelliteList();
    }
  });
  els.minElevationInput.addEventListener("change", updateElevationFromNumber);
  els.minElevationRange.addEventListener("input", updateElevationFromRange);
  document.querySelectorAll("[data-range-action]").forEach((button) => {
    button.addEventListener("click", () => extendRange(button.dataset.rangeAction));
  });
}

function setupIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setInputsFromState() {
  els.sourceSelect.value = state.source;
  els.latitudeInput.value = formatNumber(state.observer.lat, 4);
  els.longitudeInput.value = formatNumber(state.observer.lon, 4);
  els.altitudeInput.value = Math.round(state.observer.alt);
  els.minElevationInput.value = state.minElevation;
  els.minElevationRange.value = state.minElevation;
}

function loadObserver() {
  const fallback = { lat: 47.4979, lon: 19.0402, alt: 100 };
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) || "null");
    if (saved && isFinite(saved.lat) && isFinite(saved.lon) && isFinite(saved.alt)) {
      return {
        lat: clamp(Number(saved.lat), -90, 90),
        lon: clamp(Number(saved.lon), -180, 180),
        alt: clamp(Number(saved.alt), -500, 9000)
      };
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

async function loadCatalog(force) {
  setBusy(true);
  state.satellites = [];
  renderSatelliteList();
  try {
    const groups = TLE_GROUPS[state.source] || TLE_GROUPS.focused;
    const all = [];
    const errors = [];
    for (const group of groups) {
      try {
        const text = await getTleGroup(group, force);
        all.push(...parseTle(text, group));
      } catch (error) {
        errors.push(group);
      }
    }
    state.satellites = uniqueSatellites(all).sort((a, b) => a.name.localeCompare(b.name));
    state.visibleCount = LIST_STEP;
    updateCacheStamp();
    renderSatelliteList();
    if (state.satellites.length === 0) {
      setStatus("No satellites loaded");
    } else if (errors.length) {
      setStatus(`${state.satellites.length} satellites loaded, ${errors.length} group failed`);
    } else {
      setStatus(`${state.satellites.length} satellites loaded`);
    }
  } catch (error) {
    setStatus("Could not load satellite catalog");
    showToast("Could not load satellite data. Cached data may be unavailable.");
  } finally {
    setBusy(false);
  }
}

async function getTleGroup(group, force) {
  const cache = readTleCache();
  const entry = cache[group];
  const now = Date.now();
  if (entry && entry.text && now - entry.time < CACHE_MS) {
    return entry.text;
  }
  if (force && entry && entry.text && now - entry.time < CACHE_MS) {
    showToast("CelesTrak data updates about every 2 hours. Using the cached copy for now.");
    return entry.text;
  }
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=TLE`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    if (entry && entry.text) {
      showToast(`Using cached ${group} data because the live request failed.`);
      return entry.text;
    }
    throw new Error(`CelesTrak ${group} failed`);
  }
  const text = await response.text();
  if (!looksLikeTle(text)) {
    if (entry && entry.text) {
      showToast(`Using cached ${group} data because the live response was not TLE.`);
      return entry.text;
    }
    throw new Error(`CelesTrak ${group} returned no TLE`);
  }
  cache[group] = { text, time: now };
  writeTleCache(cache);
  return text;
}

function readTleCache() {
  try {
    return JSON.parse(localStorage.getItem(SATELLITE_CACHE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function writeTleCache(cache) {
  try {
    localStorage.setItem(SATELLITE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    showToast("Browser storage is full. Satellite cache was not saved.");
  }
}

function looksLikeTle(text) {
  return /^1\s+\S+/m.test(text) && /^2\s+\S+/m.test(text);
}

function parseTle(text, group) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const satellites = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i].replace(/^0\s+/, "").trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
      i -= 2;
      continue;
    }
    try {
      const satrec = window.satellite.twoline2satrec(line1, line2);
      const id = line1.slice(2, 7).trim();
      satellites.push({ id, name, line1, line2, group, satrec });
    } catch (error) {
      continue;
    }
  }
  return satellites;
}

function uniqueSatellites(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, { ...item, groups: [item.group] });
    } else {
      const existing = map.get(item.id);
      if (!existing.groups.includes(item.group)) {
        existing.groups.push(item.group);
      }
    }
  }
  return [...map.values()].map((item) => ({ ...item, groupLabel: item.groups.join(", ") }));
}

function renderSatelliteList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const base = state.listMode === "favorites"
    ? state.satellites.filter((sat) => state.favorites.has(sat.id))
    : state.satellites;
  state.filtered = base.filter((sat) => {
    if (!query) {
      return true;
    }
    return sat.name.toLowerCase().includes(query) || sat.id.includes(query);
  });
  const visible = state.filtered.slice(0, state.visibleCount);
  els.satelliteList.replaceChildren(...visible.map(createSatelliteItem));
  els.listCount.textContent = `${state.filtered.length} ${state.filtered.length === 1 ? "satellite" : "satellites"}`;
  els.listTitle.textContent = state.listMode === "favorites" ? "Favorites" : "Satellites A-Z";
  els.listHint.textContent = state.listMode === "favorites" ? "Your starred satellites" : "Select a satellite for passes";
  els.loadMoreButton.hidden = state.visibleCount >= state.filtered.length;
  if (state.filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = state.listMode === "favorites" ? "No favorites yet." : "No satellites match the search.";
    els.satelliteList.append(empty);
  }
  setupIcons();
}

function createSatelliteItem(sat) {
  const item = document.createElement("li");
  item.className = "satellite-item";
  const index = document.createElement("span");
  index.className = "satellite-index";
  index.textContent = sat.name.charAt(0).toUpperCase();
  const open = document.createElement("button");
  open.className = "satellite-open";
  open.type = "button";
  open.addEventListener("click", () => selectSatellite(sat.id));
  const name = document.createElement("span");
  name.className = "satellite-name";
  name.textContent = sat.name;
  const meta = document.createElement("span");
  meta.className = "satellite-meta";
  meta.textContent = `NORAD ${sat.id} - ${sat.groupLabel}`;
  open.append(name, meta);
  const star = document.createElement("button");
  star.className = `satellite-star${state.favorites.has(sat.id) ? " is-active" : ""}`;
  star.type = "button";
  star.setAttribute("aria-label", state.favorites.has(sat.id) ? `Remove ${sat.name} from favorites` : `Add ${sat.name} to favorites`);
  star.innerHTML = '<i data-lucide="star" aria-hidden="true"></i>';
  star.addEventListener("click", () => toggleFavorite(sat.id, sat.name));
  item.append(index, open, star);
  return item;
}

function toggleFavoritesView() {
  if (state.listMode === "favorites") {
    state.listMode = "all";
    els.favoritesToggle.setAttribute("aria-label", "Show favorites");
    els.favoritesToggle.innerHTML = '<i data-lucide="star" aria-hidden="true"></i>';
  } else {
    state.listMode = "favorites";
    els.favoritesToggle.setAttribute("aria-label", "Back to satellite list");
    els.favoritesToggle.innerHTML = '<i data-lucide="arrow-left" aria-hidden="true"></i>';
  }
  state.visibleCount = LIST_STEP;
  renderSatelliteList();
  setupIcons();
}

function toggleFavorite(id, name) {
  if (state.favorites.has(id)) {
    const confirmed = window.confirm(`Remove ${name} from favorites?`);
    if (!confirmed) {
      return;
    }
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  renderSatelliteList();
}

function selectSatellite(id) {
  const satelliteItem = state.satellites.find((sat) => sat.id === id);
  if (!satelliteItem) {
    showToast("Satellite not found in the loaded catalog.");
    return;
  }
  state.selected = satelliteItem;
  state.selectedPass = null;
  state.previousListMode = state.listMode;
  state.rangeStart = startOfLocalDay(new Date());
  state.rangeDays = 2;
  els.selectedNorad.textContent = `NORAD ${satelliteItem.id}`;
  els.selectedName.textContent = satelliteItem.name;
  updateSelectedFavorite();
  computeAndRenderPasses();
  setView("passes");
}

function updateSelectedFavorite() {
  const active = state.selected && state.favorites.has(state.selected.id);
  els.selectedFavorite.classList.toggle("is-active", Boolean(active));
  els.selectedFavorite.innerHTML = `<i data-lucide="star" aria-hidden="true"></i>${active ? "Favorited" : "Favorite"}`;
  setupIcons();
}

function updateElevationFromNumber() {
  const value = clamp(Number(els.minElevationInput.value || 0), 0, 90);
  state.minElevation = value;
  els.minElevationInput.value = value;
  els.minElevationRange.value = value;
  localStorage.setItem(ELEVATION_KEY, String(value));
  computeAndRenderPasses();
}

function updateElevationFromRange() {
  const value = Number(els.minElevationRange.value);
  state.minElevation = value;
  els.minElevationInput.value = value;
  localStorage.setItem(ELEVATION_KEY, String(value));
  computeAndRenderPasses();
}

function extendRange(action) {
  if (action === "previous") {
    state.rangeStart = addDays(state.rangeStart, -2);
    state.rangeDays += 2;
  } else {
    state.rangeDays += 2;
  }
  computeAndRenderPasses();
}

function computeAndRenderPasses() {
  if (!state.selected) {
    return;
  }
  setStatus(`Indexing passes for ${state.selected.name}`);
  window.setTimeout(() => {
    state.passes = findPasses(state.selected, state.rangeStart, state.rangeDays, state.minElevation);
    renderPasses();
    setStatus(`${state.passes.length} passes indexed`);
  }, 20);
}

function findPasses(sat, startDate, days, minElevation) {
  const start = new Date(startDate);
  const end = addDays(start, days);
  const stepMs = PASS_STEP_SECONDS * 1000;
  const pointMs = POINT_STEP_SECONDS * 1000;
  const passes = [];
  let previousTime = new Date(start);
  let previousLook = lookAngles(sat, previousTime);
  let inPass = Boolean(previousLook && previousLook.elevation > 0);
  let pass = inPass ? createPass(start, previousLook) : null;
  let lastPointTime = 0;
  for (let t = start.getTime() + stepMs; t <= end.getTime(); t += stepMs) {
    const currentTime = new Date(t);
    const currentLook = lookAngles(sat, currentTime);
    if (!currentLook) {
      previousTime = currentTime;
      previousLook = null;
      continue;
    }
    if (!inPass && previousLook && previousLook.elevation <= 0 && currentLook.elevation > 0) {
      const passStart = refineCrossing(sat, previousTime, currentTime, 0);
      pass = createPass(passStart, lookAngles(sat, passStart));
      inPass = true;
      lastPointTime = 0;
    }
    if (inPass && pass) {
      if (currentLook.elevation > pass.maxElevation) {
        pass.maxElevation = currentLook.elevation;
        pass.maxTime = currentTime;
      }
      if (t - lastPointTime >= pointMs) {
        pass.points.push({ time: currentTime, ...currentLook });
        lastPointTime = t;
      }
      if (currentLook.elevation <= 0) {
        pass.end = refineCrossing(sat, previousTime, currentTime, 0);
        improvePassPoints(sat, pass);
        if (pass.maxElevation >= minElevation) {
          passes.push(pass);
        }
        pass = null;
        inPass = false;
      }
    }
    previousTime = currentTime;
    previousLook = currentLook;
  }
  if (inPass && pass) {
    pass.end = end;
    improvePassPoints(sat, pass);
    if (pass.maxElevation >= minElevation) {
      passes.push(pass);
    }
  }
  return passes;
}

function createPass(start, look) {
  return {
    start,
    end: start,
    maxTime: start,
    maxElevation: look ? look.elevation : 0,
    points: look ? [{ time: start, ...look }] : []
  };
}

function refineCrossing(sat, a, b, elevation) {
  let low = a.getTime();
  let high = b.getTime();
  for (let i = 0; i < 10; i += 1) {
    const mid = Math.round((low + high) / 2);
    const look = lookAngles(sat, new Date(mid));
    if (!look) {
      break;
    }
    const lowLook = lookAngles(sat, new Date(low));
    if (!lowLook) {
      break;
    }
    const lowAbove = lowLook.elevation > elevation;
    const midAbove = look.elevation > elevation;
    if (lowAbove === midAbove) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return new Date(Math.round((low + high) / 2));
}

function improvePassPoints(sat, pass) {
  const points = [];
  let maxElevation = -90;
  let maxTime = pass.start;
  for (let t = pass.start.getTime(); t <= pass.end.getTime(); t += POINT_STEP_SECONDS * 1000) {
    const time = new Date(t);
    const look = lookAngles(sat, time);
    if (look && look.elevation >= -0.5) {
      points.push({ time, ...look });
      if (look.elevation > maxElevation) {
        maxElevation = look.elevation;
        maxTime = time;
      }
    }
  }
  const endLook = lookAngles(sat, pass.end);
  if (endLook) {
    points.push({ time: pass.end, ...endLook });
  }
  pass.points = points;
  pass.maxElevation = Math.max(0, maxElevation);
  pass.maxTime = maxTime;
}

function lookAngles(sat, date) {
  try {
    const positionAndVelocity = window.satellite.propagate(sat.satrec, date);
    if (!positionAndVelocity.position) {
      return null;
    }
    const gmst = window.satellite.gstime(date);
    const positionEcf = window.satellite.eciToEcf(positionAndVelocity.position, gmst);
    const observerGd = {
      longitude: degToRad(state.observer.lon),
      latitude: degToRad(state.observer.lat),
      height: state.observer.alt / 1000
    };
    const look = window.satellite.ecfToLookAngles(observerGd, positionEcf);
    return {
      azimuth: normalizeDegrees(radToDeg(look.azimuth)),
      elevation: radToDeg(look.elevation),
      range: look.rangeSat
    };
  } catch (error) {
    return null;
  }
}

function satelliteGeodetic(sat, date) {
  try {
    const positionAndVelocity = window.satellite.propagate(sat.satrec, date);
    if (!positionAndVelocity.position) {
      return null;
    }
    const gmst = window.satellite.gstime(date);
    const gd = window.satellite.eciToGeodetic(positionAndVelocity.position, gmst);
    return {
      lat: window.satellite.degreesLat(gd.latitude),
      lon: normalizeLongitude(window.satellite.degreesLong(gd.longitude)),
      alt: gd.height
    };
  } catch (error) {
    return null;
  }
}

function renderPasses() {
  updateRangeLabels();
  els.passesBody.replaceChildren();
  for (const pass of state.passes) {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.innerHTML = `
      <td>${formatDate(pass.start)}</td>
      <td>${formatTime(pass.start)}</td>
      <td>${Math.round(pass.maxElevation)}\u00b0 at ${formatTime(pass.maxTime)}</td>
      <td>${formatTime(pass.end)}</td>
    `;
    row.addEventListener("click", () => openSkyView(pass));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSkyView(pass);
      }
    });
    els.passesBody.append(row);
  }
  els.passesEmpty.hidden = state.passes.length > 0;
}

function updateRangeLabels() {
  const end = addDays(state.rangeStart, state.rangeDays - 1);
  const label = `${formatDate(state.rangeStart)} - ${formatDate(end)}`;
  els.rangeLabelTop.textContent = label;
  els.rangeLabelBottom.textContent = label;
}

function openSkyView(pass) {
  state.selectedPass = pass;
  renderSkyPlot();
  setView("sky");
}

function renderSkyPlot() {
  const pass = state.selectedPass;
  if (!pass) {
    return;
  }
  const points = pass.points.filter((point) => point.elevation >= 0).map(skyPoint);
  els.skyPath.setAttribute("points", points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "));
  if (points.length) {
    els.currentSkyDot.setAttribute("cx", points[0].x.toFixed(1));
    els.currentSkyDot.setAttribute("cy", points[0].y.toFixed(1));
  }
  els.skyDate.textContent = formatDate(pass.start);
  els.skyTitle.textContent = `${formatTime(pass.start)} - ${formatTime(pass.end)}`;
  els.skyMeta.replaceChildren(
    metaChip(`Max ${Math.round(pass.maxElevation)}\u00b0 at ${formatTime(pass.maxTime)}`),
    metaChip(`Start az ${Math.round(pass.points[0]?.azimuth || 0)}\u00b0`),
    metaChip(`End az ${Math.round(pass.points.at(-1)?.azimuth || 0)}\u00b0`)
  );
  updateSkyCountdown();
  clearInterval(state.skyTimer);
  state.skyTimer = window.setInterval(updateSkyCountdown, 1000);
}

function skyPoint(point) {
  const radius = ((90 - clamp(point.elevation, 0, 90)) / 90) * 168;
  const az = degToRad(point.azimuth);
  return {
    x: 210 + radius * Math.sin(az),
    y: 210 - radius * Math.cos(az)
  };
}

function updateSkyCountdown() {
  const pass = state.selectedPass;
  if (!pass) {
    return;
  }
  const now = new Date();
  if (now < pass.start) {
    els.countdownText.textContent = `Starts in ${formatDuration(pass.start - now)}`;
  } else if (now <= pass.end) {
    els.countdownText.textContent = `Ends in ${formatDuration(pass.end - now)}`;
  } else {
    els.countdownText.textContent = "Pass ended";
  }
  const look = lookAngles(state.selected, now);
  const visibleNow = now >= pass.start && now <= pass.end && look && look.elevation > 0;
  els.currentSkyDot.hidden = !visibleNow;
  if (visibleNow) {
    const point = skyPoint(look);
    els.currentSkyDot.setAttribute("cx", point.x.toFixed(1));
    els.currentSkyDot.setAttribute("cy", point.y.toFixed(1));
  } else {
    const fallbackPoint = now < pass.start ? pass.points[0] : pass.points.at(-1);
    if (fallbackPoint) {
      const point = skyPoint(fallbackPoint);
      els.currentSkyDot.setAttribute("cx", point.x.toFixed(1));
      els.currentSkyDot.setAttribute("cy", point.y.toFixed(1));
    }
  }

}
function metaChip(text) {
  const chip = document.createElement("span");
  chip.textContent = text;
  return chip;
}

function openMapView() {
  if (!state.selected) {
    return;
  }
  setView("map");
  initTrackMap();
  updateMapTrack();
  clearInterval(state.mapTimer);
  state.mapTimer = window.setInterval(updateMapTrack, 5000);
}

function initLocationMap() {
  if (!window.L || state.locationMap) {
    return;
  }
  state.locationMap = window.L.map(els.locationMap, {
    zoomControl: true,
    worldCopyJump: true
  }).setView([state.observer.lat, state.observer.lon], 6);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.locationMap);
  state.locationMarker = window.L.marker([state.observer.lat, state.observer.lon], {
    icon: divIcon("home-marker", "+")
  }).addTo(state.locationMap);
  state.locationMap.on("click", (event) => {
    state.observer.lat = round(event.latlng.lat, 5);
    state.observer.lon = round(event.latlng.lng, 5);
    saveObserver();
    setInputsFromState();
    updateLocationMarker();
    if (state.selected) {
      computeAndRenderPasses();
    }
  });
}

function updateLocationMarker() {
  if (state.locationMarker) {
    state.locationMarker.setLatLng([state.observer.lat, state.observer.lon]);
  }
  if (state.locationMap) {
    state.locationMap.setView([state.observer.lat, state.observer.lon], state.locationMap.getZoom());
  }
}

function initTrackMap() {
  if (!window.L || state.trackMap) {
    return;
  }
  state.trackMap = window.L.map(els.trackMap, {
    zoomControl: true,
    worldCopyJump: true
  }).setView([20, 0], 2);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.trackMap);
  window.setTimeout(() => state.trackMap.invalidateSize(), 50);
}

function updateMapTrack() {
  if (!state.selected || !state.trackMap) {
    return;
  }
  const now = new Date();
  const position = satelliteGeodetic(state.selected, now);
  if (!position) {
    els.mapDetails.textContent = "Position is unavailable for this satellite.";
    return;
  }
  els.mapSatelliteLabel.textContent = `NORAD ${state.selected.id}`;
  els.mapTitle.textContent = state.selected.name;
  els.mapClock.textContent = formatTime(now);
  els.mapDetails.textContent = `Lat ${formatNumber(position.lat, 3)}\u00b0, lon ${formatNumber(position.lon, 3)}\u00b0, altitude ${Math.round(position.alt)} km`;
  if (!state.satelliteMarker) {
    state.satelliteMarker = window.L.marker([position.lat, position.lon], {
      icon: divIcon("sat-marker", "*")
    }).addTo(state.trackMap);
  } else {
    state.satelliteMarker.setLatLng([position.lat, position.lon]);
  }
  state.trackLayers.forEach((layer) => layer.remove());
  state.trackLayers = [];
  groundTrackSegments(state.selected, now).forEach((segment) => {
    if (segment.length > 1) {
      const layer = window.L.polyline(segment, {
        color: "#f5c84c",
        weight: 2,
        opacity: 0.85
      }).addTo(state.trackMap);
      state.trackLayers.push(layer);
    }
  });
  if (state.footprintLayer) {
    state.footprintLayer.remove();
  }
  const footprint = footprintPolygon(position.lat, position.lon, position.alt);
  state.footprintLayer = window.L.polygon(footprint, {
    color: "#6bd7ff",
    weight: 2,
    opacity: 0.85,
    fillColor: "#6bd7ff",
    fillOpacity: 0.08
  }).addTo(state.trackMap);
  if (!state.trackMap.getBounds().contains([position.lat, position.lon])) {
    state.trackMap.panTo([position.lat, position.lon]);
  }
}

function groundTrackSegments(sat, centerTime) {
  const segments = [];
  let segment = [];
  let previousLon = null;
  for (let minutes = -90; minutes <= 90; minutes += 3) {
    const time = new Date(centerTime.getTime() + minutes * 60 * 1000);
    const pos = satelliteGeodetic(sat, time);
    if (!pos) {
      continue;
    }
    if (previousLon !== null && Math.abs(pos.lon - previousLon) > 180) {
      if (segment.length > 1) {
        segments.push(segment);
      }
      segment = [];
    }
    segment.push([pos.lat, pos.lon]);
    previousLon = pos.lon;
  }
  if (segment.length > 1) {
    segments.push(segment);
  }
  return segments;
}

function footprintPolygon(lat, lon, altitudeKm) {
  const angularRadius = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(0, altitudeKm)));
  const points = [];
  for (let bearing = 0; bearing <= 360; bearing += 4) {
    points.push(destinationPoint(lat, lon, bearing, angularRadius));
  }
  return points;
}

function destinationPoint(lat, lon, bearing, angularDistance) {
  const lat1 = degToRad(lat);
  const lon1 = degToRad(lon);
  const brng = degToRad(bearing);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [radToDeg(lat2), normalizeLongitude(radToDeg(lon2))];
}

function divIcon(className, text) {
  return window.L.divIcon({
    className,
    html: text,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function updateObserverFromInputs() {
  state.observer.lat = clamp(Number(els.latitudeInput.value || 0), -90, 90);
  state.observer.lon = clamp(Number(els.longitudeInput.value || 0), -180, 180);
  state.observer.alt = clamp(Number(els.altitudeInput.value || 0), -500, 9000);
  setInputsFromState();
  saveObserver();
  updateLocationMarker();
  if (state.selected) {
    computeAndRenderPasses();
  }
}

function useDeviceLocation() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not available in this browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.observer.lat = round(position.coords.latitude, 5);
      state.observer.lon = round(position.coords.longitude, 5);
      if (isFinite(position.coords.altitude)) {
        state.observer.alt = Math.round(position.coords.altitude);
      }
      setInputsFromState();
      saveObserver();
      updateLocationMarker();
      if (state.selected) {
        computeAndRenderPasses();
      }
    },
    () => showToast("Could not read device location.")
  );
}

function saveObserver() {
  localStorage.setItem(LOCATION_KEY, JSON.stringify(state.observer));
}

function setView(view) {
  ["list", "passes", "sky", "map"].forEach((name) => {
    const element = els[`${name}View`];
    element.hidden = name !== view;
    element.classList.toggle("is-active", name === view);
  });
  els.backButton.hidden = view === "list";
  els.mapButton.hidden = view !== "passes";
  els.refreshButton.hidden = view !== "list";
  els.favoritesToggle.hidden = view !== "list";
  if (view !== "map") {
    clearInterval(state.mapTimer);
  }
  if (view !== "sky") {
    clearInterval(state.skyTimer);
  }
  if (view === "map" && state.trackMap) {
    window.setTimeout(() => state.trackMap.invalidateSize(), 50);
  }
  setupIcons();
}

function goBack() {
  if (!els.mapView.hidden) {
    setView("passes");
    return;
  }
  if (!els.skyView.hidden) {
    setView("passes");
    return;
  }
  if (!els.passesView.hidden) {
    state.selected = null;
    state.selectedPass = null;
    state.listMode = state.previousListMode;
    renderSatelliteList();
    setView("list");
  }
}

function setBusy(isBusy) {
  els.refreshButton.disabled = isBusy;
  els.sourceSelect.disabled = isBusy;
}

function setStatus(text) {
  els.statusLine.textContent = text;
}

function updateCacheStamp() {
  const cache = readTleCache();
  const times = Object.values(cache).map((entry) => entry.time).filter(Boolean);
  if (!times.length) {
    els.cacheStamp.textContent = "No cache yet";
    return;
  }
  const newest = Math.max(...times);
  els.cacheStamp.textContent = `Cached ${formatTime(new Date(newest))}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatNumber(value, digits) {
  return Number(value).toFixed(digits);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  if (!isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function degToRad(value) {
  return value * Math.PI / 180;
}

function radToDeg(value) {
  return value * 180 / Math.PI;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function normalizeLongitude(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}
