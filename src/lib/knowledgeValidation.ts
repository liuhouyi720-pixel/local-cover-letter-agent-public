import { parseJsonWithRepairs } from "./validate";
import { CandidateProposal, ContentPlan, JobRequirement, KNOWLEDGE_CATEGORIES, RankedKnowledge } from "./knowledgeTypes";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function parsedObject(raw: string): Result<Record<string, unknown>> {
  const parsed = parseJsonWithRepairs(raw);
  if (!parsed.ok) return parsed;
  return isObject(parsed.parsed) ? { ok: true, data: parsed.parsed } : { ok: false, error: "Output must be a JSON object." };
}

export function parseRequirements(raw: string): Result<JobRequirement[]> {
  const parsed = parsedObject(raw); if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.data.requirements)) return { ok: false, error: "requirements must be an array." };
  const result: JobRequirement[] = [];
  for (const item of parsed.data.requirements) {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.text !== "string" || !strings(item.keywords) ||
      !["required", "preferred", "context"].includes(String(item.priority))) return { ok: false, error: "Invalid requirement object." };
    result.push({ id: item.id, text: item.text, kind: typeof item.kind === "string" ? item.kind : "responsibility",
      priority: item.priority as JobRequirement["priority"], keywords: item.keywords });
  }
  return { ok: true, data: result };
}

export function parseCandidateProposals(raw: string): Result<CandidateProposal[]> {
  const parsed = parsedObject(raw); if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.data.candidates)) return { ok: false, error: "candidates must be an array." };
  const result: CandidateProposal[] = [];
  for (const item of parsed.data.candidates) {
    if (!isObject(item) || !["create", "update", "merge", "conflict"].includes(String(item.candidate_action)) ||
      !KNOWLEDGE_CATEGORIES.includes(item.proposed_category as never) || typeof item.proposed_title !== "string" ||
      typeof item.proposed_summary !== "string" || !isObject(item.proposed_details) || !strings(item.proposed_tags) ||
      typeof item.source_text !== "string" || !item.source_text.trim()) return { ok: false, error: "Invalid memory candidate object." };
    result.push(item as unknown as CandidateProposal);
  }
  return { ok: true, data: result };
}

export function parseDuplicateDecision(raw: string): Result<{ candidate_action: CandidateProposal["candidate_action"]; possible_match_id: string | null; reason: string }> {
  const parsed = parsedObject(raw); if (!parsed.ok) return parsed;
  if (!["create", "update", "merge", "conflict"].includes(String(parsed.data.candidate_action)) ||
    !(parsed.data.possible_match_id === null || typeof parsed.data.possible_match_id === "string") || typeof parsed.data.reason !== "string") {
    return { ok: false, error: "Invalid duplicate decision." };
  }
  return { ok: true, data: parsed.data as { candidate_action: CandidateProposal["candidate_action"]; possible_match_id: string | null; reason: string } };
}

export function parseRankedKnowledge(raw: string): Result<{ ranked_items: RankedKnowledge[]; uncovered_requirement_ids: string[] }> {
  const parsed = parsedObject(raw); if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.data.ranked_items) || !strings(parsed.data.uncovered_requirement_ids)) return { ok: false, error: "Invalid ranking output." };
  const ranked = parsed.data.ranked_items;
  if (ranked.some((item) => !isObject(item) || typeof item.knowledge_item_id !== "string" || !strings(item.matched_requirement_ids) ||
    typeof item.reason !== "string" || typeof item.score !== "number")) return { ok: false, error: "Invalid ranked item." };
  return { ok: true, data: { ranked_items: ranked as RankedKnowledge[], uncovered_requirement_ids: parsed.data.uncovered_requirement_ids } };
}

export function parseContentPlan(raw: string): Result<ContentPlan> {
  const parsed = parsedObject(raw); if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.data.selections) || !Array.isArray(parsed.data.paragraphs) ||
    !strings(parsed.data.uncovered_requirement_ids) || !strings(parsed.data.warnings)) return { ok: false, error: "Invalid content plan." };
  return { ok: true, data: parsed.data as unknown as ContentPlan };
}
