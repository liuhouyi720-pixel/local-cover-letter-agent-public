const LOCAL_AGENT_APP_URL = "http://127.0.0.1:5173";
const LOCAL_IMPORT_URL = "http://127.0.0.1:3031/import-job";

const elements = {
  statusText: document.getElementById("statusText"),
  detectionBadge: document.getElementById("detectionBadge"),
  confidenceBadge: document.getElementById("confidenceBadge"),
  titleInput: document.getElementById("titleInput"),
  companyInput: document.getElementById("companyInput"),
  locationInput: document.getElementById("locationInput"),
  descriptionInput: document.getElementById("descriptionInput"),
  urlInput: document.getElementById("urlInput"),
  warningsList: document.getElementById("warningsList"),
  extractBtn: document.getElementById("extractBtn"),
  reExtractBtn: document.getElementById("reExtractBtn"),
  sendBtn: document.getElementById("sendBtn"),
  openBtn: document.getElementById("openBtn")
};

const state = {
  source: "generic"
};

hydrateFromStorage();
wireEvents();

function wireEvents() {
  elements.extractBtn.addEventListener("click", () => {
    void handleExtract();
  });

  elements.reExtractBtn.addEventListener("click", () => {
    void handleExtract();
  });

  elements.sendBtn.addEventListener("click", () => {
    void handleSendToLocalAgent();
  });

  elements.openBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: LOCAL_AGENT_APP_URL });
  });

  [
    elements.titleInput,
    elements.companyInput,
    elements.locationInput,
    elements.descriptionInput,
    elements.urlInput
  ].forEach((input) => {
    input.addEventListener("input", persistFormToStorage);
  });
}

async function handleExtract() {
  setStatus("Extracting from current page...");
  clearWarnings();

  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    setStatus("Cannot find active tab.");
    setDetection("unsupported", "low");
    addWarning("No active tab is available.");
    return;
  }

  const pageUrl = tab.url || "";
  if (!isSupportedHost(pageUrl)) {
    state.source = "generic";
    setDetection("unsupported", "low");
    setStatus("Unsupported page. LinkedIn and Handshake are supported in this MVP.");
    setField("urlInput", pageUrl);
    addWarning("This page is outside extension host permissions for MVP.");
    persistFormToStorage();
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_JOB_FROM_PAGE" });
    if (!response || !response.ok || !response.extraction) {
      throw new Error(response?.error || "No extraction response.");
    }

    applyExtraction(response.extraction);
    setStatus("Extraction complete. Review and confirm before sending.");
    persistFormToStorage();
  } catch (error) {
    setDetection("unsupported", "low");
    setStatus("Extraction failed. You can copy/paste manually.");
    addWarning(error instanceof Error ? error.message : "Could not read page content.");
  }
}

function applyExtraction(extraction) {
  state.source = extraction.source || "generic";
  setField("titleInput", extraction.title || "");
  setField("companyInput", extraction.company || "");
  setField("locationInput", extraction.location || "");
  setField("descriptionInput", extraction.description || "");
  setField("urlInput", extraction.url || "");

  setDetection(extraction.detection || "unsupported", extraction.confidence || "low");

  clearWarnings();
  (extraction.warnings || []).forEach((warning) => addWarning(warning));
}

async function handleSendToLocalAgent() {
  clearWarnings();

  const payload = {
    source: normalizeSource(state.source),
    title: elements.titleInput.value.trim(),
    company: elements.companyInput.value.trim(),
    location: elements.locationInput.value.trim(),
    description: elements.descriptionInput.value.trim(),
    url: elements.urlInput.value.trim(),
    importedAt: new Date().toISOString()
  };

  const missing = validatePayload(payload);
  if (missing.length > 0) {
    setStatus("Please complete required fields before sending.");
    missing.forEach((field) => addWarning(`${field} is required.`));
    return;
  }

  try {
    const response = await fetch(LOCAL_IMPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Import failed with HTTP ${response.status}`);
    }

    setStatus("Sent to local agent. Open Step 2 in the app to load it.");
    (data.warnings || []).forEach((warning) => addWarning(warning));
    persistFormToStorage();
  } catch (error) {
    setStatus("Local agent is not running.");
    addWarning(error instanceof Error ? error.message : "Failed to reach local helper.");
  }
}

function validatePayload(payload) {
  const required = ["title", "company", "location", "description", "url", "importedAt"];
  return required.filter((key) => !payload[key]);
}

function normalizeSource(source) {
  if (source === "linkedin" || source === "handshake" || source === "generic") {
    return source;
  }
  return "generic";
}

function setField(key, value) {
  if (elements[key]) {
    elements[key].value = value;
  }
}

function setDetection(detection, confidence) {
  const detectionLabel = {
    linkedin: "LinkedIn job page detected",
    handshake: "Handshake job page detected",
    generic: "Generic page detected",
    unsupported: "Unsupported page"
  };

  elements.detectionBadge.textContent = detectionLabel[detection] || detectionLabel.unsupported;
  elements.confidenceBadge.textContent = (confidence || "low").toLowerCase();
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function addWarning(message) {
  const item = document.createElement("li");
  item.textContent = message;
  elements.warningsList.appendChild(item);
}

function clearWarnings() {
  elements.warningsList.innerHTML = "";
}

function isSupportedHost(urlText) {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    return host.endsWith("linkedin.com") || host.endsWith("joinhandshake.com");
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function persistFormToStorage() {
  const snapshot = {
    source: state.source,
    title: elements.titleInput.value,
    company: elements.companyInput.value,
    location: elements.locationInput.value,
    description: elements.descriptionInput.value,
    url: elements.urlInput.value
  };

  chrome.storage.local.set({ jdImportPreview: snapshot });
}

function hydrateFromStorage() {
  chrome.storage.local.get(["jdImportPreview"], (result) => {
    const snapshot = result.jdImportPreview;
    if (!snapshot || typeof snapshot !== "object") return;

    state.source = normalizeSource(snapshot.source);
    setField("titleInput", typeof snapshot.title === "string" ? snapshot.title : "");
    setField("companyInput", typeof snapshot.company === "string" ? snapshot.company : "");
    setField("locationInput", typeof snapshot.location === "string" ? snapshot.location : "");
    setField("descriptionInput", typeof snapshot.description === "string" ? snapshot.description : "");
    setField("urlInput", typeof snapshot.url === "string" ? snapshot.url : "");

    setDetection(state.source, "low");
  });
}
