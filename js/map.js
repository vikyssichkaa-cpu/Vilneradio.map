import { MAP_CONFIG, FEATURE_STYLE, FEATURE_HOVER_STYLE } from "./config.js";

const map = L.map("map", {
  zoomControl: true,
  minZoom: MAP_CONFIG.minZoom,
  maxZoom: MAP_CONFIG.maxZoom,
  maxBoundsViscosity: 1,
  worldCopyJump: false,
});

const statusEl = document.getElementById("status");
let geoJsonLayer;

L.tileLayer(MAP_CONFIG.tileUrl, {
  attribution: MAP_CONFIG.tileAttribution,
  subdomains: "abcd",
  maxZoom: MAP_CONFIG.maxZoom,
}).addTo(map);

L.control.scale({ imperial: false }).addTo(map);
map.setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);

initMap();

async function initMap() {
  setStatus("Loading map objects...");
  const decisionsByAddress = await loadCsvDecisions();
  await loadGeoJson(decisionsByAddress);
}

async function loadCsvDecisions() {
  try {
    const response = await fetch(encodeURI(MAP_CONFIG.decisionsCsvPath), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load CSV: ${response.status}`);
    }

    const csvText = await response.text();
    return parseDecisionsCsv(csvText);
  } catch (error) {
    console.warn(error);
    return new Map();
  }
}

function normalizeAddress(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseDecisionsCsv(csvText) {
  const data = csvText.replace(/\uFEFF/, "");
  const lines = data.trim().split(/\r?\n/);
  const map = new Map();

  if (lines.length <= 1) {
    return map;
  }

  lines.shift();
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const [address, date, ...rest] = line.split(",");
    const decision = rest.join(",").trim();
    if (!address) {
      continue;
    }

    const normalized = normalizeAddress(address);
    const record = {
      address: address.trim(),
      date: date?.trim() || "",
      decision,
    };

    const list = map.get(normalized) || [];
    list.push(record);
    map.set(normalized, list);
  }

  for (const records of map.values()) {
    records.sort((a, b) => a.date.localeCompare(b.date, "uk", { numeric: true }));
  }

  return map;
}

async function loadGeoJson(decisionsByAddress) {
  setStatus("Loading map objects...");

  try {
    const response = await fetch(MAP_CONFIG.geoJsonPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load GeoJSON: ${response.status}`);
    }

    const geoJson = await response.json();
    geoJsonLayer = L.geoJSON(geoJson, {
      style: FEATURE_STYLE,
      onEachFeature: (feature, layer) => onEachFeature(feature, layer, decisionsByAddress),
    }).addTo(map);

    const bounds = geoJsonLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });

      const paddedBounds = bounds.pad(MAP_CONFIG.maxBoundsPad);
      map.setMaxBounds(paddedBounds);

      const currentZoom = map.getZoom();
      if (MAP_CONFIG.initialZoom > currentZoom) {
        map.setView(bounds.getCenter(), MAP_CONFIG.initialZoom);
      }

      map.setMinZoom(MAP_CONFIG.minZoom);
    }

    const featureCount = Array.isArray(geoJson.features) ? geoJson.features.length : 0;
    setStatus(`Loaded ${featureCount} objects`);
  } catch (error) {
    console.error(error);
    setStatus(`GeoJSON loading error. Check ${MAP_CONFIG.geoJsonPath}`, true);
  }
}

function onEachFeature(feature, layer, decisionsByAddress) {
  layer.bindPopup(buildPopupHtml(feature, decisionsByAddress), { maxWidth: 360 });

  layer.on({
    mouseover(event) {
      event.target.setStyle(FEATURE_HOVER_STYLE);
      event.target.bringToFront();
    },
    mouseout(event) {
      if (geoJsonLayer) {
        geoJsonLayer.resetStyle(event.target);
      }
    },
  });
}

function getFeatureAddress(props) {
  return props["Повна адреса"] || "";
}

function buildPopupHtml(feature, decisionsByAddress) {
  const props = feature.properties || {};
  const fullAddress = getFeatureAddress(props);
  
  if (!fullAddress) {
    return `<div class="popup"><p>Немає інформації про об’єкт</p></div>`;
  }
  
  const coordsHtml = props.Latitude && props.Longitude
    ? `<p class="popup__coords"><strong>Координати:</strong> ${escapeHtml(String(props.Latitude).substring(0, 10))}, ${escapeHtml(String(props.Longitude).substring(0, 10))}</p>`
    : "";
  
  const decisionHtml = buildDecisionsHtml(props, decisionsByAddress);
  
  return `
    <div class="popup">
      <h3 class="popup__title">🏢 ${escapeHtml(fullAddress)}</h3>
      ${coordsHtml}
      ${decisionHtml}
    </div>
  `;
}

function buildDecisionsHtml(props, decisionsByAddress) {
  const address = getFeatureAddress(props);
  const decisions = decisionsByAddress.get(normalizeAddress(address));
  
  if (!decisions || decisions.length === 0) {
    return `<div class="popup__decisions"><p class="popup__no-decisions"><strong>📋 Рішення:</strong> не знайдено</p></div>`;
  }

  const rows = decisions
    .map((item) => {
      const isUrl = safeUrl(item.decision);
      const decisionDisplay = isUrl
        ? `<a href="${isUrl}" target="_blank" rel="noopener" class="popup__decision-link">📄 ${escapeHtml(item.decision)}</a>`
        : `<span class="popup__decision-text">${escapeHtml(item.decision)}</span>`;
      return `<li class="popup__decision-item"><span class="popup__date">${escapeHtml(item.date || "—")}:</span> ${decisionDisplay}</li>`;
    })
    .join("");

  return `
    <div class="popup__decisions">
      <p class="popup__decisions-title"><strong>📋 Рішення (${decisions.length}):</strong></p>
      <ul class="popup__decisions-list">${rows}</ul>
    </div>
  `;
}

function safeUrl(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }

  try {
    const url = new URL(rawValue.trim());
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
  statusEl.classList.add("status--visible");

  if (!isError) {
    window.setTimeout(() => {
      statusEl.classList.remove("status--visible");
    }, 3200);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
