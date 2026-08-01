import { normalizeText, validateCandidateInput, validateKnowledgeInput, validateRequirements } from "./validation.mjs";

function searchableItem(item) {
  return normalizeText([item.title, item.summary, JSON.stringify(item.details), item.tags.map((tag) => tag.name).join(" ")].join(" "));
}

export class KnowledgeService {
  constructor(repository) { this.repository = repository; }

  list(filters) { return this.repository.listKnowledge(filters); }
  get(id) { return this.repository.getKnowledge(id); }
  versions(id) { return this.repository.getVersions(id); }
  usage(id) { return this.repository.getUsageForKnowledge(id); }

  createManual(input) {
    const valid = validateKnowledgeInput({ ...input, source_type: input.source_type || "manual" });
    return this.repository.db.transaction(() => this.repository.createKnowledge(valid))();
  }

  update(id, input, reason) {
    const valid = validateKnowledgeInput(input, { partial: true });
    return this.repository.db.transaction(() => this.repository.updateKnowledge(id, valid, { reason }))();
  }

  setStatus(id, status) {
    if (!["active", "disabled", "archived"].includes(status)) throw new Error("Invalid knowledge status.");
    return this.update(id, { status }, `Status changed to ${status}`);
  }

  createSession(input) {
    return this.repository.createSession({
      company_name: typeof input?.company_name === "string" ? input.company_name.trim() : "",
      job_title: typeof input?.job_title === "string" ? input.job_title.trim() : "",
      job_description: typeof input?.job_description === "string" ? input.job_description.trim() : "",
      user_instructions: typeof input?.user_instructions === "string" ? input.user_instructions.trim() : "",
      parsed_requirements: input?.parsed_requirements ? validateRequirements(input.parsed_requirements) : []
    });
  }

  getSession(id) { return this.repository.getSession(id); }

  updateSession(id, input) {
    const safe = { ...input };
    if (input.parsed_requirements !== undefined) safe.parsed_requirements = validateRequirements(input.parsed_requirements);
    return this.repository.updateSession(id, safe);
  }

  recordUsage(sessionId, input) {
    if (!this.repository.getSession(sessionId)) throw new Error("Application session not found.");
    const allowed = new Set(["retrieved", "recommended", "selected", "used_in_draft", "removed_by_user", "not_used"]);
    if (!allowed.has(input?.usage_status)) throw new Error("Invalid usage status.");
    return this.repository.recordUsage({ application_session_id: sessionId,
      knowledge_item_id: typeof input.knowledge_item_id === "string" ? input.knowledge_item_id : null,
      memory_candidate_id: typeof input.memory_candidate_id === "string" ? input.memory_candidate_id : null,
      usage_status: input.usage_status,
      requirement_id: typeof input.requirement_id === "string" ? input.requirement_id : null,
      selection_reason: typeof input.selection_reason === "string" ? input.selection_reason : "" });
  }

  findPossibleMatch(candidate) {
    const organization = normalizeText(candidate.proposed_details.organization);
    const title = normalizeText(candidate.proposed_title);
    const tagSet = new Set(candidate.proposed_tags.map(normalizeText));
    const pool = this.repository.listKnowledge({ status: "all", search: candidate.proposed_title, limit: 12 });
    let best = null; let bestScore = 0;
    for (const item of pool) {
      let score = 0;
      if (normalizeText(item.title) === title) score += 5;
      else if (normalizeText(item.title).includes(title) || title.includes(normalizeText(item.title))) score += 2;
      if (organization && normalizeText(item.details.organization) === organization) score += 3;
      for (const tag of item.tags) if (tagSet.has(normalizeText(tag.name))) score += 0.5;
      if (score > bestScore) { best = item; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
  }

  createCandidates(sessionId, inputs) {
    if (!Array.isArray(inputs)) throw new Error("candidates must be an array.");
    return this.repository.db.transaction(() => inputs.map((raw) => {
      const valid = validateCandidateInput(raw);
      const match = valid.possible_match_id ? this.repository.getKnowledge(valid.possible_match_id) : this.findPossibleMatch(valid);
      if (match && valid.candidate_action === "create") valid.candidate_action = "update";
      valid.possible_match_id = match?.id || valid.possible_match_id;
      return this.repository.createCandidate(sessionId, valid);
    }))();
  }

  approveCandidate(id, input = {}) {
    const candidate = this.repository.getCandidate(id);
    if (!candidate) throw new Error("Candidate not found.");
    if (candidate.status !== "pending") throw new Error("Only pending candidates can be approved.");
    const useNow = !!input.use_in_current;
    const saveFuture = !!input.save_for_future;
    if (!useNow && !saveFuture) throw new Error("Choose use now, save for future, or both.");
    const edited = input.edited ? validateCandidateInput({
      candidate_action: input.edited.candidate_action || candidate.candidate_action,
      proposed_category: input.edited.proposed_category || candidate.proposed_category,
      proposed_title: input.edited.proposed_title || candidate.proposed_title,
      proposed_summary: input.edited.proposed_summary || candidate.proposed_summary,
      proposed_details: input.edited.proposed_details ?? candidate.proposed_details,
      proposed_tags: input.edited.proposed_tags ?? candidate.proposed_tags,
      source_text: candidate.source_text,
      source_type: candidate.source_type,
      source_reference: candidate.source_reference,
      possible_match_id: input.edited.possible_match_id ?? candidate.possible_match_id
    }) : {
      candidate_action: candidate.candidate_action, proposed_category: candidate.proposed_category,
      proposed_title: candidate.proposed_title, proposed_summary: candidate.proposed_summary,
      proposed_details: candidate.proposed_details, proposed_tags: candidate.proposed_tags,
      source_text: candidate.source_text, source_type: candidate.source_type,
      source_reference: candidate.source_reference, possible_match_id: candidate.possible_match_id
    };

    return this.repository.db.transaction(() => {
      let knowledgeItem = null;
      if (saveFuture) {
        const payload = validateKnowledgeInput({ category: edited.proposed_category, title: edited.proposed_title,
          summary: edited.proposed_summary, details: edited.proposed_details, tags: edited.proposed_tags,
          source_type: edited.source_type, source_reference: edited.source_reference, source_text: edited.source_text,
          status: "active" });
        if (["update", "merge", "conflict"].includes(edited.candidate_action) && edited.possible_match_id) {
          knowledgeItem = this.repository.updateKnowledge(edited.possible_match_id, payload,
            { reason: `Approved candidate ${id}`, changeType: edited.candidate_action });
        } else {
          knowledgeItem = this.repository.createKnowledge(payload, { reason: `Approved candidate ${id}`, sourceCandidateId: id });
        }
      }
      this.repository.db.prepare(`UPDATE memory_candidates SET candidate_action=?, proposed_category=?, proposed_title=?,
        proposed_summary=?, proposed_details_json=?, proposed_tags_json=?, possible_match_id=?, use_in_current=?,
        save_for_future=?, status=?, approved_knowledge_item_id=?, updated_at=? WHERE id=?`)
        .run(edited.candidate_action, edited.proposed_category, edited.proposed_title, edited.proposed_summary,
          JSON.stringify(edited.proposed_details), JSON.stringify(edited.proposed_tags), edited.possible_match_id,
          useNow ? 1 : 0, saveFuture ? 1 : 0, input.edited ? "edited_and_approved" : "approved",
          knowledgeItem?.id || null, new Date().toISOString(), id);
      if (useNow) this.repository.recordUsage({ application_session_id: candidate.application_session_id,
        knowledge_item_id: knowledgeItem?.id, memory_candidate_id: id, usage_status: "selected",
        selection_reason: "Approved by user for this application" });
      return { candidate: this.repository.getCandidate(id), knowledge_item: knowledgeItem };
    })();
  }

  rejectCandidate(id) {
    const candidate = this.repository.getCandidate(id);
    if (!candidate) throw new Error("Candidate not found.");
    if (candidate.status !== "pending") throw new Error("Only pending candidates can be rejected.");
    this.repository.db.prepare("UPDATE memory_candidates SET status='rejected', use_in_current=0, save_for_future=0, updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    return this.repository.getCandidate(id);
  }

  retrieve(sessionId, requirementsInput) {
    const requirements = validateRequirements(requirementsInput);
    this.repository.updateSession(sessionId, { parsed_requirements: requirements });
    const today = new Date().toISOString().slice(0, 10);
    const active = this.repository.listKnowledge({ status: "active", limit: 250 })
      .filter((item) => {
        const usableFor = Array.isArray(item.details.usable_for) ? item.details.usable_for.map(normalizeText) : [];
        return item.verified_by_user && (!item.valid_from || item.valid_from <= today) && (!item.valid_to || item.valid_to >= today) &&
          (usableFor.length === 0 || usableFor.some((value) => ["cover letter", "application", "all"].includes(value)));
      });
    const ranked = active.map((item) => {
      const haystack = searchableItem(item);
      const matches = requirements.map((requirement) => {
        const terms = [...requirement.keywords, ...normalizeText(requirement.text).split(" ").filter((term) => term.length > 3)];
        const score = [...new Set(terms.map(normalizeText).filter(Boolean))].reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { requirement_id: requirement.id, score };
      }).filter((entry) => entry.score > 0);
      return { item, score: matches.reduce((sum, match) => sum + match.score, 0), matched_requirements: matches.map((m) => m.requirement_id) };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
    for (const entry of ranked) this.repository.recordUsage({ application_session_id: sessionId,
      knowledge_item_id: entry.item.id, usage_status: "retrieved", selection_reason: "Structured SQL relevance match" });
    return { items: ranked, uncovered_requirement_ids: requirements.filter((r) => !ranked.some((x) => x.matched_requirements.includes(r.id))).map((r) => r.id), fts_available: this.repository.ftsAvailable };
  }
}
