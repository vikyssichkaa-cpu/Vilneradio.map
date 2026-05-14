import { MAP_CONFIG, FEATURE_STYLE, FEATURE_HOVER_STYLE } from "./config.js";

const map = L.map("map", {
  zoomControl: true,
  minZoom: MAP_CONFIG.minZoom,
  maxZoom: MAP_CONFIG.maxZoom,
  maxBoundsViscosity: 0.5,
  worldCopyJump: false,
  zoomAnimation: true,
  fadeAnimation: true,
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

    const dateValue = date?.trim() || "";
    if (!dateValue) {
      continue;
    }

    const normalized = normalizeAddress(address);
    const record = {
      address: address.trim(),
      date: dateValue,
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
  setStatus("Завантаження об'єктів...");

  try {
    const response = await fetch(MAP_CONFIG.geoJsonPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load GeoJSON: ${response.status}`);
    }

    const geoJson = await response.json();
    geoJsonLayer = L.geoJSON(geoJson, {
      style: (feature) => getStyleByDecisions(feature, decisionsByAddress),
      onEachFeature: (feature, layer) => onEachFeature(feature, layer, decisionsByAddress),
    }).addTo(map);

    const bounds = geoJsonLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], animate: true, duration: 0.8 });

      const paddedBounds = bounds.pad(MAP_CONFIG.maxBoundsPad);
      map.setMaxBounds(paddedBounds);

      map.setMinZoom(MAP_CONFIG.minZoom);
    }

    const featureCount = Array.isArray(geoJson.features) ? geoJson.features.length : 0;
    setStatus(`Завантажено ${featureCount} об'єктів`);
  } catch (error) {
    console.error(error);
    setStatus(`GeoJSON loading error. Check ${MAP_CONFIG.geoJsonPath}`, true);
  }
}

function onEachFeature(feature, layer, decisionsByAddress) {
  layer.bindPopup(buildPopupHtml(feature, decisionsByAddress), { 
    maxWidth: 380,
    minWidth: 320,
    className: "feature-popup",
    closeButton: true,
  });

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

function getStyleByDecisions(feature, decisionsByAddress) {
  const props = feature.properties || {};
  const address = getFeatureAddress(props);
  const decisions = decisionsByAddress.get(normalizeAddress(address)) || [];
  const decisionCount = decisions.length;

  let fillColor = "#fdd7d7";
  let fillOpacity = 0.30;
  let strokeColor = "#f5a9a9";
  let strokeWeight = 2;

  if (decisionCount === 0) {
    fillColor = "#fdd7d7";
    fillOpacity = 0.30;
    strokeColor = "#f5a9a9";
  } else if (decisionCount === 1) {
    fillColor = "#ffb3b3";
    fillOpacity = 0.40;
    strokeColor = "#ff8080";
  } else if (decisionCount === 2) {
    fillColor = "#ff9999";
    fillOpacity = 0.45;
    strokeColor = "#ff6666";
    strokeWeight = 2.1;
  } else if (decisionCount === 3) {
    fillColor = "#ff7777";
    fillOpacity = 0.50;
    strokeColor = "#ff4444";
    strokeWeight = 2.2;
  } else if (decisionCount === 4) {
    fillColor = "#ff5555";
    fillOpacity = 0.55;
    strokeColor = "#ff2222";
    strokeWeight = 2.3;
  } else if (decisionCount <= 6) {
    fillColor = "#ff3333";
    fillOpacity = 0.60;
    strokeColor = "#dd0000";
    strokeWeight = 2.3;
  } else {
    fillColor = "#dd0000";
    fillOpacity = 0.65;
    strokeColor = "#aa0000";
    strokeWeight = 2.4;
  }

  return {
    color: strokeColor,
    weight: strokeWeight,
    opacity: 0.95,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
  };
}

function getFeatureAddress(props) {
  return props["Повна адреса"] || "";
}

function formatAddress(rawAddress) {
  const value = String(rawAddress || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "";
  }

  if (value.includes(",")) {
    return value;
  }

  const parts = value.split(" ");
  if (parts.length >= 3) {
    return `${parts[0]}, ${parts[1]}, ${parts.slice(2).join(" ")}`;
  }

  if (parts.length === 2) {
    return `${parts[0]}, ${parts[1]}`;
  }

  return value;
}

function buildPopupHtml(feature, decisionsByAddress) {
  const props = feature.properties || {};
  const fullAddress = formatAddress(getFeatureAddress(props));
  
  if (!fullAddress) {
    return `<div class="MapPopup"><p>Немає інформації про об’єкт</p></div>`;
  }
  
  const decisionHtml = buildDecisionsHtml(props, decisionsByAddress);
  
  return `
    <div class="MapPopup">
      <h3 class="MapPopup__title">🏢 ${escapeHtml(fullAddress)}</h3>
      ${decisionHtml}
    </div>
  `;
}

function buildDecisionsHtml(props, decisionsByAddress) {
  const address = getFeatureAddress(props);
  const decisions = decisionsByAddress.get(normalizeAddress(address));
  
  if (!decisions || decisions.length === 0) {
    return `<div class="DecisionList"><p class="DecisionList__no-decisions"><strong>📋 Рішення:</strong> не знайдено</p></div>`;
  }

  const showAll = decisions.length <= 3;
  const visibleDecisions = showAll ? decisions : decisions.slice(0, 3);
  
  const rows = visibleDecisions
    .map((item, index) => {
      const decisionDisplay = formatDecisionLink(item.decision, item.date, index + 1);
      return `<li class="DecisionItem">
        <span class="DecisionItem__date">${escapeHtml(item.date || "—")}</span>
        <span class="DecisionItem__link">${decisionDisplay}</span>
      </li>`;
    })
    .join("");

  const showMoreButton = !showAll ? `<button class="DecisionList__show-more" onclick="this.parentElement.classList.add('DecisionList--expanded')">Показати ще (${decisions.length - 3})</button>` : "";
  
  const allRows = showAll ? rows : rows + decisions.slice(3).map((item, index) => {
    const decisionDisplay = formatDecisionLink(item.decision, item.date, index + 4);
    return `<li class="DecisionItem DecisionItem--hidden">
      <span class="DecisionItem__date">${escapeHtml(item.date || "—")}</span>
      <span class="DecisionItem__link">${decisionDisplay}</span>
    </li>`;
  }).join("");

  return `
    <div class="DecisionList">
      <p class="DecisionList__title"><strong>📋 Рішення (${decisions.length}):</strong></p>
      <ul class="DecisionList__list">${allRows}</ul>
      ${showMoreButton}
    </div>
  `;
}

function formatDecisionLink(rawDecision, date, index) {
  if (!rawDecision) {
    return `<span class="DocumentLink DocumentLink--text">(невідоме)</span>`;
  }

  const trimmed = String(rawDecision).trim();
  const isUrl = safeUrl(trimmed);

  // Коротка назва рішення з датою
  const readableName = `Рішення про компенсацію за знищене майно від ${date || "невідомої дати"}`;
  
  if (isUrl) {
    return `<a href="${isUrl}" target="_blank" rel="noopener" class="DocumentLink">📄 ${escapeHtml(readableName)}</a>`;
  }

  if (trimmed.match(/^[a-f0-9]{32}\.pdf$/i)) {
    const pdfUrl = `https://rada.info/upload/users_files/32897190/${trimmed}`;
    return `<a href="${pdfUrl}" target="_blank" rel="noopener" class="DocumentLink">📄 ${escapeHtml(readableName)}</a>`;
  }

  return `<span class="DocumentLink DocumentLink--text">${escapeHtml(readableName)}</span>`;
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
