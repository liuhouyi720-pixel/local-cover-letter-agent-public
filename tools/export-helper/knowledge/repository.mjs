import { randomUUID } from "node:crypto";
import { normalizeText, parseJson } from "./validation.mjs";

const DEFAULT_PROFILE_ID = "default";
const now = () => new Date().toISOString();

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

export class KnowledgeRepository {
  constructor(db, { ftsAvailable = false } = {}) {
    this.db = db;
    this.ftsAvailable = ftsAvailable;
    const timestamp = now();
    this.db.prepare(`INSERT OR IGNORE INTO profiles(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(DEFAULT_PROFILE_ID, "Local profile", timestamp, timestamp);
  }

  mapItem(row) {
    if (!row) return null;
    const tags = this.db.prepare(`SELECT t.name, t.tag_type FROM knowledge_tags t
      JOIN knowledge_item_tags it ON it.tag_id = t.id WHERE it.knowledge_item_id = ? ORDER BY t.name`).all(row.id);
    return {
      id: row.id, profile_id: row.profile_id, category: row.category, title: row.title,
      summary: row.summary, details: parseJson(row.details_json, {}),
      source_type: row.source_type, source_reference: row.source_reference, source_text: row.source_text,
      verified_by_user: !!row.verified_by_user, status: row.status,
      valid_from: row.valid_from, valid_to: row.valid_to,
      tags, created_at: row.created_at, updated_at: row.updated_at
    };
  }

  getKnowledge(id) {
    return this.mapItem(this.db.prepare("SELECT * FROM personal_knowledge_items WHERE id = ?").get(id));
  }

  listKnowledge(filters = {}) {
    const conditions = ["k.profile_id = ?"];
    const params = [DEFAULT_PROFILE_ID];
    if (filters.status && filters.status !== "all") { conditions.push("k.status = ?"); params.push(filters.status); }
    if (filters.category) { conditions.push("k.category = ?"); params.push(filters.category); }
    if (filters.tag) {
      conditions.push(`EXISTS (SELECT 1 FROM knowledge_item_tags it JOIN knowledge_tags t ON t.id = it.tag_id
        WHERE it.knowledge_item_id = k.id AND t.normalized_name = ?)`);
      params.push(normalizeText(filters.tag));
    }
    const search = normalizeText(filters.search);
    if (search) {
      const tokens = search.split(" ").filter(Boolean);
      if (this.ftsAvailable) {
        conditions.push("k.id IN (SELECT knowledge_item_id FROM knowledge_fts WHERE knowledge_fts MATCH ?)");
        params.push(tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR "));
      } else {
        const likeParts = tokens.map(() => `(lower(k.title) LIKE ? OR lower(k.summary) LIKE ? OR lower(k.details_json) LIKE ? OR EXISTS (
          SELECT 1 FROM knowledge_item_tags sit JOIN knowledge_tags st ON st.id = sit.tag_id
          WHERE sit.knowledge_item_id = k.id AND st.normalized_name LIKE ?))`);
        conditions.push(`(${likeParts.join(" OR ")})`);
        for (const token of tokens) params.push(`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`);
      }
    }
    const rows = this.db.prepare(`SELECT k.* FROM personal_knowledge_items k WHERE ${conditions.join(" AND ")}
      ORDER BY k.updated_at DESC LIMIT ?`).all(...params, Math.min(Number(filters.limit) || 100, 250));
    return rows.map((row) => this.mapItem(row));
  }

  syncFts(item, tags) {
    if (!this.ftsAvailable) return;
    this.db.prepare("DELETE FROM knowledge_fts WHERE knowledge_item_id = ?").run(item.id);
    this.db.prepare(`INSERT INTO knowledge_fts(knowledge_item_id, title, summary, searchable_details, tags)
      VALUES (?, ?, ?, ?, ?)`).run(item.id, item.title, item.summary, JSON.stringify(item.details), tags.join(" "));
  }

  replaceTags(itemId, tags, profileId = DEFAULT_PROFILE_ID) {
    this.db.prepare("DELETE FROM knowledge_item_tags WHERE knowledge_item_id = ?").run(itemId);
    for (const rawTag of tags) {
      const name = rawTag.trim();
      const normalized = normalizeText(name);
      if (!normalized) continue;
      let tag = this.db.prepare("SELECT id FROM knowledge_tags WHERE profile_id = ? AND normalized_name = ? AND tag_type = 'topic'")
        .get(profileId, normalized);
      if (!tag) {
        tag = { id: randomUUID() };
        this.db.prepare(`INSERT INTO knowledge_tags(id, profile_id, name, normalized_name, tag_type, created_at)
          VALUES (?, ?, ?, ?, 'topic', ?)`).run(tag.id, profileId, name, normalized, now());
      }
      this.db.prepare("INSERT OR IGNORE INTO knowledge_item_tags(knowledge_item_id, tag_id) VALUES (?, ?)").run(itemId, tag.id);
    }
  }

  writeVersion(item, changeType, reason) {
    const current = this.db.prepare("SELECT COALESCE(MAX(version_number), 0) AS value FROM knowledge_versions WHERE knowledge_item_id = ?")
      .get(item.id).value;
    this.db.prepare(`INSERT INTO knowledge_versions(id, knowledge_item_id, version_number, snapshot_json, change_type, change_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), item.id, current + 1, JSON.stringify(item), changeType, reason || "", now());
  }

  createKnowledge(input, { reason = "Manual creation", sourceCandidateId = null } = {}) {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO personal_knowledge_items(
      id, profile_id, category, title, normalized_title, summary, details_json,
      source_type, source_reference, source_text, verified_by_user, status,
      valid_from, valid_to, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
      .run(id, DEFAULT_PROFILE_ID, input.category, input.title, normalizeText(input.title), input.summary,
        JSON.stringify(input.details), input.source_type, input.source_reference, input.source_text,
        input.status || "active", input.valid_from, input.valid_to, timestamp, timestamp);
    this.replaceTags(id, input.tags || []);
    const item = this.getKnowledge(id);
    this.writeVersion(item, sourceCandidateId ? "candidate_approval" : "create", reason);
    this.syncFts(item, (input.tags || []));
    return item;
  }

  updateKnowledge(id, input, { reason = "User edit", changeType = "update" } = {}) {
    const current = this.getKnowledge(id);
    if (!current) throw new Error("Knowledge item not found.");
    const next = { ...current, ...input, details: input.details ?? current.details };
    this.db.prepare(`UPDATE personal_knowledge_items SET category=?, title=?, normalized_title=?, summary=?, details_json=?,
      source_type=?, source_reference=?, source_text=?, status=?, valid_from=?, valid_to=?, updated_at=? WHERE id=?`)
      .run(next.category, next.title, normalizeText(next.title), next.summary, JSON.stringify(next.details), next.source_type,
        next.source_reference, next.source_text, next.status, next.valid_from, next.valid_to, now(), id);
    const tags = input.tags ?? current.tags.map((tag) => tag.name);
    this.replaceTags(id, tags);
    const item = this.getKnowledge(id);
    this.writeVersion(item, changeType, reason);
    this.syncFts(item, tags);
    return item;
  }

  getVersions(id) {
    return this.db.prepare("SELECT * FROM knowledge_versions WHERE knowledge_item_id = ? ORDER BY version_number DESC").all(id)
      .map((row) => ({ ...row, snapshot: parseJson(row.snapshot_json, {}) }));
  }

  getUsageForKnowledge(id) {
    return this.db.prepare(`SELECT u.*, s.company_name, s.job_title FROM knowledge_usage u
      JOIN application_sessions s ON s.id = u.application_session_id WHERE u.knowledge_item_id = ? ORDER BY u.created_at DESC`).all(id);
  }

  createSession(input = {}) {
    const id = randomUUID(); const timestamp = now();
    this.db.prepare(`INSERT INTO application_sessions(id, profile_id, company_name, job_title, job_description,
      parsed_requirements_json, user_instructions, selected_knowledge_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?)`)
      .run(id, DEFAULT_PROFILE_ID, input.company_name || "", input.job_title || "", input.job_description || "",
        JSON.stringify(input.parsed_requirements || []), input.user_instructions || "", timestamp, timestamp);
    return this.getSession(id);
  }

  getSession(id) {
    const row = this.db.prepare("SELECT * FROM application_sessions WHERE id = ?").get(id);
    if (!row) return null;
    return { ...row, parsed_requirements: parseJson(row.parsed_requirements_json, []),
      selected_knowledge: parseJson(row.selected_knowledge_json, []), content_plan: parseJson(row.content_plan_json, null) };
  }

  updateSession(id, input) {
    const current = this.getSession(id); if (!current) throw new Error("Application session not found.");
    const next = { ...current, ...input };
    this.db.prepare(`UPDATE application_sessions SET company_name=?, job_title=?, job_description=?, parsed_requirements_json=?,
      user_instructions=?, selected_knowledge_json=?, content_plan_json=?, draft=?, final_text=?, status=?, updated_at=? WHERE id=?`)
      .run(next.company_name || "", next.job_title || "", next.job_description || "", JSON.stringify(next.parsed_requirements || []),
        next.user_instructions || "", JSON.stringify(next.selected_knowledge || []), next.content_plan ? JSON.stringify(next.content_plan) : null,
        next.draft || "", next.final_text || "", next.status || "active", now(), id);
    return this.getSession(id);
  }

  createCandidate(sessionId, input) {
    if (!this.getSession(sessionId)) throw new Error("Application session not found.");
    const id = randomUUID(); const timestamp = now();
    this.db.prepare(`INSERT INTO memory_candidates(id, application_session_id, candidate_action, proposed_category,
      proposed_title, proposed_summary, proposed_details_json, proposed_tags_json, source_text, source_type,
      source_reference, possible_match_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, sessionId, input.candidate_action, input.proposed_category, input.proposed_title, input.proposed_summary,
        JSON.stringify(input.proposed_details), JSON.stringify(input.proposed_tags), input.source_text, input.source_type,
        input.source_reference, input.possible_match_id, timestamp, timestamp);
    return this.getCandidate(id);
  }

  getCandidate(id) {
    const row = this.db.prepare("SELECT * FROM memory_candidates WHERE id = ?").get(id);
    if (!row) return null;
    return { ...row, proposed_details: parseJson(row.proposed_details_json, {}), proposed_tags: parseJson(row.proposed_tags_json, []),
      use_in_current: !!row.use_in_current, save_for_future: !!row.save_for_future };
  }

  listCandidates(sessionId, status) {
    const rows = status ? this.db.prepare("SELECT * FROM memory_candidates WHERE application_session_id=? AND status=? ORDER BY created_at").all(sessionId, status)
      : this.db.prepare("SELECT * FROM memory_candidates WHERE application_session_id=? ORDER BY created_at").all(sessionId);
    return rows.map((row) => this.getCandidate(row.id));
  }

  recordUsage(input) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO knowledge_usage(id, application_session_id, knowledge_item_id, memory_candidate_id,
      usage_status, requirement_id, selection_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.application_session_id, input.knowledge_item_id || null, input.memory_candidate_id || null,
        input.usage_status, input.requirement_id || null, input.selection_reason || "", now());
    return { id, ...input };
  }
}

export { DEFAULT_PROFILE_ID };
