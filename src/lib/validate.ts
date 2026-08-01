export type EvidenceItem = {
  cover_letter_sentence: string;
  resume_evidence: string[];
  source_ids: string[];
};

export type AISuggestion = {
  status: "red" | "yellow" | "green";
  score: number;
  summary: string;
  reasons: string[];
  actions: string[];
};

export type CoverLetterResult = {
  cover_letter: string;
  evidence_map: EvidenceItem[];
  ai_suggestion: AISuggestion;
  missing_info_questions: string[];
};

type ValidationResult =
  | { ok: true; data: CoverLetterResult }
  | { ok: false; error: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSuggestionStatus(value: unknown): value is AISuggestion["status"] {
  return value === "red" || value === "yellow" || value === "green";
}

function stripMarkdownCodeFences(raw: string): string {
  return raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractBalancedJsonObjects(raw: string): string[] {
  const input = stripMarkdownCodeFences(raw);
  const results: string[] = [];

  for (let start = 0; start < input.length; start += 1) {
    if (input[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < input.length; i += 1) {
      const char = input[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          results.push(input.slice(start, i + 1));
          break;
        }
      }
    }
  }

  if (results.length > 0) {
    return results;
  }

  // Fallback for malformed outputs.
  return [input];
}

function escapeControlCharsInsideStrings(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }

      if (char === '"') {
        output += char;
        inString = false;
        continue;
      }

      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      if (char === "\t") {
        output += "\\t";
        continue;
      }

      output += char;
      continue;
    }

    if (char === '"') {
      inString = true;
    }
    output += char;
  }

  return output;
}

function removeTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonWithRepairs(
  raw: string
): { ok: true; parsed: unknown } | { ok: false; error: string } {
  const candidates = extractBalancedJsonObjects(raw.trim());
  let lastError = "Unknown JSON parse error";

  for (const candidate of candidates) {
    const attempts = [
      candidate,
      escapeControlCharsInsideStrings(candidate),
      removeTrailingCommas(escapeControlCharsInsideStrings(candidate))
    ];

    for (const attempt of attempts) {
      try {
        return { ok: true, parsed: JSON.parse(attempt) };
      } catch (error) {
        lastError = (error as Error).message;
      }
    }
  }

  return { ok: false, error: `JSON parse error: ${lastError}` };
}

export function tryParseAndValidate(raw: string): ValidationResult {
  const parsedResult = parseJsonWithRepairs(raw);
  if (!parsedResult.ok) {
    return { ok: false, error: parsedResult.error };
  }

  const parsed = parsedResult.parsed;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Top-level JSON must be an object." };
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.cover_letter !== "string") {
    return { ok: false, error: "\"cover_letter\" must be a string." };
  }
  if (!Array.isArray(obj.evidence_map)) {
    return { ok: false, error: "\"evidence_map\" must be an array." };
  }
  if (!obj.ai_suggestion || typeof obj.ai_suggestion !== "object" || Array.isArray(obj.ai_suggestion)) {
    return { ok: false, error: "\"ai_suggestion\" must be an object." };
  }
  if (!isStringArray(obj.missing_info_questions)) {
    return { ok: false, error: "\"missing_info_questions\" must be an array of strings." };
  }

  for (let i = 0; i < obj.evidence_map.length; i += 1) {
    const item = obj.evidence_map[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `evidence_map[${i}] must be an object.` };
    }

    const evidenceObj = item as Record<string, unknown>;
    if (typeof evidenceObj.cover_letter_sentence !== "string") {
      return { ok: false, error: `evidence_map[${i}].cover_letter_sentence must be a string.` };
    }
    if (!isStringArray(evidenceObj.resume_evidence)) {
      return { ok: false, error: `evidence_map[${i}].resume_evidence must be an array of strings.` };
    }
    if (evidenceObj.source_ids === undefined) evidenceObj.source_ids = [];
    if (!isStringArray(evidenceObj.source_ids)) {
      return { ok: false, error: `evidence_map[${i}].source_ids must be an array of strings.` };
    }
  }

  const suggestionObj = obj.ai_suggestion as Record<string, unknown>;
  if (!isSuggestionStatus(suggestionObj.status)) {
    return { ok: false, error: "\"ai_suggestion.status\" must be one of red/yellow/green." };
  }
  if (typeof suggestionObj.score !== "number" || Number.isNaN(suggestionObj.score) || suggestionObj.score < 0 || suggestionObj.score > 10) {
    return { ok: false, error: "\"ai_suggestion.score\" must be a number in [0,10]." };
  }
  if (typeof suggestionObj.summary !== "string") {
    return { ok: false, error: "\"ai_suggestion.summary\" must be a string." };
  }
  if (!isStringArray(suggestionObj.reasons)) {
    return { ok: false, error: "\"ai_suggestion.reasons\" must be an array of strings." };
  }
  if (!isStringArray(suggestionObj.actions)) {
    return { ok: false, error: "\"ai_suggestion.actions\" must be an array of strings." };
  }

  return { ok: true, data: obj as CoverLetterResult };
}
