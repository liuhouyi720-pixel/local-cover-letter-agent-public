const MIN_DESCRIPTION_LENGTH = 120;

const NOISE_SELECTOR = [
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
  "svg"
].join(",");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "EXTRACT_JOB_FROM_PAGE") {
    return;
  }

  try {
    const extraction = extractJobFromCurrentPage();
    sendResponse({ ok: true, extraction });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Extraction failed."
    });
  }
});

function extractJobFromCurrentPage() {
  const sourceSite = detectSourceSite(location.hostname);
  const warnings = [];

  let extraction;
  if (sourceSite === "linkedin") {
    extraction = extractLinkedInJob();
  } else if (sourceSite === "handshake") {
    extraction = extractHandshakeJob();
  } else {
    extraction = extractGenericJob();
  }

  if (!extraction.description) {
    extraction = {
      ...extraction,
      description: "",
      confidence: "low",
      detection: "unsupported"
    };
    warnings.push("No description text was found on this page.");
  }

  if (extraction.description.length > 0 && extraction.description.length < MIN_DESCRIPTION_LENGTH) {
    warnings.push(`Description is short (${extraction.description.length} characters).`);
  }

  return {
    source: extraction.source,
    title: extraction.title,
    company: extraction.company,
    location: extraction.location,
    description: extraction.description,
    url: location.href,
    confidence: extraction.confidence,
    detection: extraction.detection,
    warnings
  };
}

function detectSourceSite(hostname) {
  const normalized = (hostname || "").toLowerCase();
  if (normalized.includes("linkedin.com")) return "linkedin";
  if (normalized.includes("joinhandshake.com")) return "handshake";
  return "generic";
}

function extractLinkedInJob() {
  const title = firstText([
    "h1",
    "[data-test-id='job-details-job-title']",
    ".job-details-jobs-unified-top-card__job-title",
    ".top-card-layout__title"
  ]);

  const company = firstText([
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".topcard__org-name-link",
    ".topcard__flavor-row a"
  ]);

  const locationText = firstText([
    ".job-details-jobs-unified-top-card__bullet",
    ".topcard__flavor--bullet",
    ".jobs-unified-top-card__bullet"
  ]);

  const description = firstLargeText([
    ".jobs-description__content",
    "#job-details",
    "[data-test-id='job-details-description']",
    "main",
    "article",
    "[role='main']"
  ]);

  const looksLikeJobPage = Boolean(title && (description.length > 200 || company));

  if (!looksLikeJobPage) {
    const generic = extractGenericJob();
    return {
      ...generic,
      source: "linkedin",
      detection: generic.description ? "generic" : "unsupported",
      confidence: generic.description ? "low" : "low"
    };
  }

  return {
    source: "linkedin",
    title,
    company,
    location: locationText,
    description,
    confidence: description.length > 600 ? "high" : "medium",
    detection: "linkedin"
  };
}

function extractHandshakeJob() {
  const title = firstText([
    "h1",
    "[data-testid='job-title']",
    "[class*='job-title']"
  ]);

  const company = firstText([
    "[data-testid='employer-name']",
    "[class*='employer']",
    "[class*='company']"
  ]);

  const locationText = firstText([
    "[data-testid='job-location']",
    "[class*='location']",
    "[class*='job-location']"
  ]);

  const description = firstLargeText([
    "[data-testid='job-description']",
    "section[aria-label*='Description']",
    "[class*='job-description']",
    "main",
    "article",
    "[role='main']"
  ]);

  const looksLikeJobPage = Boolean(title && (description.length > 200 || company));

  if (!looksLikeJobPage) {
    const generic = extractGenericJob();
    return {
      ...generic,
      source: "handshake",
      detection: generic.description ? "generic" : "unsupported",
      confidence: generic.description ? "low" : "low"
    };
  }

  return {
    source: "handshake",
    title,
    company,
    location: locationText,
    description,
    confidence: description.length > 600 ? "high" : "medium",
    detection: "handshake"
  };
}

function extractGenericJob() {
  const title = firstText([
    "h1",
    "main h2",
    "article h1",
    "article h2"
  ]);

  const likelyJobContainer = findLikelyJobContainer();
  const description = likelyJobContainer
    ? textFromElement(likelyJobContainer)
    : firstLargeText(["main", "article", "[role='main']"]);

  const company = firstLabeledValue(["Company", "Employer", "Organization"]) || "";
  const locationText = firstLabeledValue(["Location", "Work location"]) || "";

  let finalDescription = description;
  if (!finalDescription || finalDescription.length < 180) {
    finalDescription = sanitizeText(document.body ? document.body.innerText : "");
  }

  return {
    source: "generic",
    title,
    company,
    location: locationText,
    description: finalDescription,
    confidence: finalDescription.length > 700 ? "medium" : "low",
    detection: finalDescription ? "generic" : "unsupported"
  };
}

function findLikelyJobContainer() {
  const candidates = Array.from(document.querySelectorAll("main, article, [role='main'], section, div"));

  const scored = candidates
    .filter((el) => isVisibleElement(el))
    .map((el) => {
      const text = sanitizeText(el.innerText || "");
      const hint = (
        (el.id || "") +
        " " +
        (el.className || "") +
        " " +
        (el.getAttribute("aria-label") || "")
      ).toLowerCase();

      let score = text.length;
      if (hint.includes("description")) score += 1200;
      if (hint.includes("job")) score += 800;
      if (hint.includes("responsibil")) score += 400;
      if (hint.includes("requirement")) score += 400;
      if (text.length < 300) score -= 900;

      return { el, score, textLength: text.length };
    })
    .filter((row) => row.textLength > 160)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.el || null;
}

function firstText(selectors) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const text = textFromElement(element);
      if (text) return text;
    }
  }
  return "";
}

function firstLargeText(selectors) {
  const candidates = [];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (!isVisibleElement(element)) continue;
      const text = textFromElement(element);
      if (text.length >= 180) {
        candidates.push(text);
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || "";
}

function firstLabeledValue(labels) {
  const allText = sanitizeText(document.body ? document.body.innerText : "");
  if (!allText) return "";

  const lines = allText.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    for (const label of labels) {
      const prefix = `${label.toLowerCase()}:`;
      if (line.toLowerCase().startsWith(prefix)) {
        return line.slice(prefix.length).trim();
      }
    }
  }
  return "";
}

function textFromElement(element) {
  if (!element || !isVisibleElement(element)) return "";

  const clone = element.cloneNode(true);
  const removable = clone.querySelectorAll(NOISE_SELECTOR + ", [aria-hidden='true'], [hidden]");
  removable.forEach((node) => node.remove());

  return sanitizeText(clone.innerText || "");
}

function isVisibleElement(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (!style) return true;

  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity || "1") === 0) return false;

  return true;
}

function sanitizeText(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
