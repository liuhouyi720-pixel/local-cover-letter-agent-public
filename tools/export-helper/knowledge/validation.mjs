export const KNOWLEDGE_CATEGORIES = new Set([
  "education", "work_experience", "project", "skill", "achievement",
  "volunteer_experience", "story", "preference", "career_goal", "value", "experience_detail"
]);
export const KNOWLEDGE_STATUSES = new Set(["active", "disabled", "archived"]);
export const CANDIDATE_ACTIONS = new Set(["create", "update", "merge", "conflict"]);

export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\banalytics\b/g, "analysis").replace(/\s+/g, " ").trim();
}

function string(value, field, { required = false, max = 20000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const result = value.trim();
  if (required && !result) throw new Error(`${field} is required.`);
  if (result.length > max) throw new Error(`${field} is too long.`);
  return result;
}

function stringArray(value, field, max = 50) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  if (value.length > max) throw new Error(`${field} contains too many values.`);
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

export function validateDetails(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("details must be an object.");
  const allowed = new Set([
    "organization", "role", "actions", "results", "skills", "target_roles",
    "usable_for", "reflection", "dates", "related_knowledge_item_id"
  ]);
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (["actions", "results", "skills", "target_roles", "usable_for"].includes(key)) {
      result[key] = stringArray(raw, `details.${key}`);
    } else if (key === "dates") {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("details.dates must be an object.");
      result.dates = {
        start: string(raw.start, "details.dates.start", { max: 100 }),
        end: string(raw.end, "details.dates.end", { max: 100 })
      };
    } else {
      result[key] = string(raw, `details.${key}`, { max: 5000 });
    }
  }
  return result;
}

export function validateKnowledgeInput(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Knowledge item must be an object.");
  const category = string(input.category, "category", { required: !partial, max: 80 });
  if (category && !KNOWLEDGE_CATEGORIES.has(category)) throw new Error(`Unsupported category: ${category}.`);
  const status = string(input.status, "status", { max: 20 }) || (partial ? "" : "active");
  if (status && !KNOWLEDGE_STATUSES.has(status)) throw new Error(`Unsupported status: ${status}.`);
  return {
    ...(category ? { category } : {}),
    ...(input.title !== undefined || !partial ? { title: string(input.title, "title", { required: true, max: 300 }) } : {}),
    ...(input.summary !== undefined || !partial ? { summary: string(input.summary, "summary", { required: true, max: 5000 }) } : {}),
    ...(input.details !== undefined || !partial ? { details: validateDetails(input.details) } : {}),
    ...(input.tags !== undefined || !partial ? { tags: stringArray(input.tags, "tags") } : {}),
    ...(input.source_type !== undefined || !partial ? { source_type: string(input.source_type, "source_type", { max: 80 }) || "manual" } : {}),
    ...(input.source_reference !== undefined || !partial ? { source_reference: string(input.source_reference, "source_reference", { max: 1000 }) } : {}),
    ...(input.source_text !== undefined || !partial ? { source_text: string(input.source_text, "source_text", { max: 20000 }) } : {}),
    ...(status ? { status } : {}),
    ...(input.valid_from !== undefined || !partial ? { valid_from: string(input.valid_from, "valid_from", { max: 100 }) || null } : {}),
    ...(input.valid_to !== undefined || !partial ? { valid_to: string(input.valid_to, "valid_to", { max: 100 }) || null } : {})
  };
}

export function validateCandidateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Candidate must be an object.");
  const action = string(input.candidate_action, "candidate_action", { required: true, max: 20 });
  if (!CANDIDATE_ACTIONS.has(action)) throw new Error(`Unsupported candidate action: ${action}.`);
  const knowledge = validateKnowledgeInput({
    category: input.proposed_category,
    title: input.proposed_title,
    summary: input.proposed_summary,
    details: input.proposed_details,
    tags: input.proposed_tags,
    source_type: input.source_type,
    source_reference: input.source_reference,
    source_text: input.source_text
  });
  return {
    candidate_action: action,
    proposed_category: knowledge.category,
    proposed_title: knowledge.title,
    proposed_summary: knowledge.summary,
    proposed_details: knowledge.details,
    proposed_tags: knowledge.tags,
    source_type: knowledge.source_type,
    source_reference: knowledge.source_reference,
    source_text: string(input.source_text, "source_text", { required: true, max: 20000 }),
    possible_match_id: string(input.possible_match_id, "possible_match_id", { max: 100 }) || null
  };
}

export function validateRequirements(value) {
  if (!Array.isArray(value)) throw new Error("requirements must be an array.");
  return value.slice(0, 40).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`requirements[${index}] must be an object.`);
    return {
      id: string(item.id, `requirements[${index}].id`, { required: true, max: 100 }),
      text: string(item.text, `requirements[${index}].text`, { required: true, max: 1000 }),
      kind: string(item.kind, `requirements[${index}].kind`, { max: 50 }) || "responsibility",
      priority: ["required", "preferred", "context"].includes(item.priority) ? item.priority : "preferred",
      keywords: stringArray(item.keywords, `requirements[${index}].keywords`, 30)
    };
  });
}

export function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
