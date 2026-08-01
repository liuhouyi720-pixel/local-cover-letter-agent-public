import {
  ApplicationSession, JobRequirement, KnowledgeInput, KnowledgeItem, KnowledgeStatus, MemoryCandidate
} from "./knowledgeTypes";

const BASE_URL = "http://127.0.0.1:3031";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) }
    });
  } catch {
    throw new Error("Cannot reach the local knowledge service. Start it with `npm run export-helper`.");
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Knowledge service HTTP ${response.status}.`);
  return data;
}

export async function listKnowledge(filters: { search?: string; category?: string; status?: string; tag?: string } = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => !!value) as string[][]);
  return (await request<{ items: KnowledgeItem[] }>(`/knowledge?${query}`)).items;
}

export async function createKnowledge(input: KnowledgeInput) {
  return (await request<{ item: KnowledgeItem }>("/knowledge", { method: "POST", body: JSON.stringify(input) })).item;
}

export async function updateKnowledge(id: string, input: Partial<KnowledgeInput> & { change_reason?: string }) {
  return (await request<{ item: KnowledgeItem }>(`/knowledge/${id}`, { method: "PUT", body: JSON.stringify(input) })).item;
}

export async function setKnowledgeStatus(id: string, status: KnowledgeStatus) {
  return (await request<{ item: KnowledgeItem }>(`/knowledge/${id}/status`, { method: "POST", body: JSON.stringify({ status }) })).item;
}

export async function getKnowledgeHistory(id: string) {
  return request<{ versions: Array<{ version_number: number; change_type: string; change_reason: string; created_at: string; snapshot: KnowledgeItem }>;
    usage: never[] }>(`/knowledge/${id}/versions`);
}

export async function getKnowledgeUsage(id: string) {
  return (await request<{ usage: Array<Record<string, string>> }>(`/knowledge/${id}/usage`)).usage;
}

export async function createApplicationSession(input: Partial<ApplicationSession> = {}) {
  return (await request<{ session: ApplicationSession }>("/knowledge/sessions", { method: "POST", body: JSON.stringify(input) })).session;
}

export async function getApplicationSession(id: string) {
  return (await request<{ session: ApplicationSession }>(`/knowledge/sessions/${id}`)).session;
}

export async function updateApplicationSession(id: string, input: Partial<ApplicationSession>) {
  return (await request<{ session: ApplicationSession }>(`/knowledge/sessions/${id}`, { method: "PUT", body: JSON.stringify(input) })).session;
}

export async function createMemoryCandidates(sessionId: string, candidates: unknown[]) {
  return (await request<{ candidates: MemoryCandidate[] }>(`/knowledge/sessions/${sessionId}/candidates`, {
    method: "POST", body: JSON.stringify({ candidates })
  })).candidates;
}

export async function listMemoryCandidates(sessionId: string, status?: string) {
  return (await request<{ candidates: MemoryCandidate[] }>(`/knowledge/sessions/${sessionId}/candidates${status ? `?status=${status}` : ""}`)).candidates;
}

export async function approveMemoryCandidate(id: string, input: { use_in_current: boolean; save_for_future: boolean; edited?: unknown }) {
  return request<{ candidate: MemoryCandidate; knowledge_item: KnowledgeItem | null }>(`/knowledge/candidates/${id}/approve`, {
    method: "POST", body: JSON.stringify(input)
  });
}

export async function rejectMemoryCandidate(id: string) {
  return (await request<{ candidate: MemoryCandidate }>(`/knowledge/candidates/${id}/reject`, { method: "POST", body: "{}" })).candidate;
}

export async function retrieveKnowledge(sessionId: string, requirements: JobRequirement[]) {
  return request<{ items: Array<{ item: KnowledgeItem; score: number; matched_requirements: string[] }>;
    uncovered_requirement_ids: string[]; fts_available: boolean }>(`/knowledge/sessions/${sessionId}/retrieve`, {
      method: "POST", body: JSON.stringify({ requirements })
    });
}

export async function recordKnowledgeUsage(sessionId: string, input: { knowledge_item_id?: string; memory_candidate_id?: string;
  usage_status: "retrieved" | "recommended" | "selected" | "used_in_draft" | "removed_by_user" | "not_used";
  requirement_id?: string; selection_reason?: string }) {
  return request<{ usage: Record<string, string> }>(`/knowledge/sessions/${sessionId}/usage`, {
    method: "POST", body: JSON.stringify(input)
  });
}
