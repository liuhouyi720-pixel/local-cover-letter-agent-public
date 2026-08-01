import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openKnowledgeDatabase } from "../tools/export-helper/knowledge/database.mjs";
import { KnowledgeRepository } from "../tools/export-helper/knowledge/repository.mjs";
import { KnowledgeService } from "../tools/export-helper/knowledge/service.mjs";

async function fixture(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cla-knowledge-test-"));
  const opened = await openKnowledgeDatabase({ databasePath: path.join(dir, "test.sqlite"), ...options });
  const repository = new KnowledgeRepository(opened.db, { ftsAvailable: opened.ftsAvailable });
  const service = new KnowledgeService(repository);
  return { ...opened, repository, service, async close() { opened.db.close(); await rm(dir, { recursive: true, force: true }); } };
}

const proposal = (overrides = {}) => ({ candidate_action: "create", proposed_category: "project",
  proposed_title: "Forecasting project", proposed_summary: "Built a demand forecasting workflow.",
  proposed_details: { organization: "University", actions: ["Built a model"], results: [], skills: ["Python"] },
  proposed_tags: ["Data Analysis", "python"], source_text: "Built a demand forecasting workflow in Python.",
  source_type: "application_supplement", source_reference: "typed supplement", possible_match_id: null, ...overrides });

test("pending and rejected candidates never modify permanent knowledge", async () => {
  const fx = await fixture(); try {
    const session = fx.service.createSession({ job_description: "Employer wants forecasting skills." });
    const [candidate] = fx.service.createCandidates(session.id, [proposal()]);
    assert.equal(fx.service.list({ status: "all" }).length, 0);
    fx.service.rejectCandidate(candidate.id);
    assert.equal(fx.service.list({ status: "all" }).length, 0);
    assert.equal(fx.service.retrieve(session.id, [{ id: "r1", text: "forecasting", kind: "skill", priority: "required", keywords: ["forecasting"] }]).items.length, 0);
  } finally { await fx.close(); }
});

test("approval is independently usable now and savable for future", async () => {
  const fx = await fixture(); try {
    const first = fx.service.createSession({});
    const [nowOnly] = fx.service.createCandidates(first.id, [proposal({ proposed_title: "Now only" })]);
    const nowResult = fx.service.approveCandidate(nowOnly.id, { use_in_current: true, save_for_future: false });
    assert.equal(nowResult.knowledge_item, null);
    assert.equal(nowResult.candidate.use_in_current, true);
    assert.equal(fx.service.list({ status: "all" }).length, 0);

    const [futureOnly] = fx.service.createCandidates(first.id, [proposal({ proposed_title: "Future database project", proposed_summary: "Designed SQL reports.", proposed_tags: ["SQL"] })]);
    const futureResult = fx.service.approveCandidate(futureOnly.id, { use_in_current: false, save_for_future: true });
    assert.ok(futureResult.knowledge_item);
    assert.equal(futureResult.candidate.use_in_current, false);
    const second = fx.service.createSession({ company_name: "NewCo" });
    const retrieved = fx.service.retrieve(second.id, [{ id: "r2", text: "SQL reporting", kind: "skill", priority: "required", keywords: ["sql"] }]);
    assert.equal(retrieved.items[0].item.id, futureResult.knowledge_item.id);
  } finally { await fx.close(); }
});

test("similar candidates propose an update and approval creates a version", async () => {
  const fx = await fixture(); try {
    const item = fx.service.createManual({ category: "project", title: "Forecasting Project", summary: "Original summary",
      details: { organization: "University" }, tags: ["data-analysis"], source_type: "manual", source_reference: "", source_text: "Original" });
    const session = fx.service.createSession({});
    const [candidate] = fx.service.createCandidates(session.id, [proposal({ proposed_title: "Forecasting Project" })]);
    assert.equal(candidate.candidate_action, "update");
    assert.equal(candidate.possible_match_id, item.id);
    fx.service.approveCandidate(candidate.id, { use_in_current: false, save_for_future: true });
    const versions = fx.service.versions(item.id);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].change_type, "update");
  } finally { await fx.close(); }
});

test("job descriptions and generated drafts remain session data, not personal knowledge", async () => {
  const fx = await fixture(); try {
    const session = fx.service.createSession({ company_name: "EmployerCo", job_description: "The candidate manages a team." });
    fx.service.updateSession(session.id, { draft: "Generated claim-like prose." });
    assert.equal(fx.service.list({ status: "all" }).length, 0);
    assert.equal(fx.repository.listCandidates(session.id).length, 0);
  } finally { await fx.close(); }
});

test("failed candidate approval rolls back item, version, tags, and candidate status", async () => {
  const fx = await fixture(); try {
    const session = fx.service.createSession({});
    const [candidate] = fx.service.createCandidates(session.id, [proposal()]);
    const original = fx.repository.writeVersion.bind(fx.repository);
    fx.repository.writeVersion = () => { throw new Error("simulated version failure"); };
    assert.throws(() => fx.service.approveCandidate(candidate.id, { use_in_current: true, save_for_future: true }), /simulated/);
    fx.repository.writeVersion = original;
    assert.equal(fx.service.list({ status: "all" }).length, 0);
    assert.equal(fx.repository.getCandidate(candidate.id).status, "pending");
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS value FROM knowledge_versions").get().value, 0);
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS value FROM knowledge_tags").get().value, 0);
  } finally { await fx.close(); }
});

test("disabled and archived items are excluded from retrieval and can be restored", async () => {
  const fx = await fixture(); try {
    const item = fx.service.createManual({ category: "skill", title: "SQL", summary: "Uses SQL", details: { skills: ["SQL"] }, tags: ["SQL"], source_type: "manual" });
    const req = [{ id: "r", text: "SQL", kind: "skill", priority: "required", keywords: ["sql"] }];
    for (const status of ["disabled", "archived"]) {
      fx.service.setStatus(item.id, status);
      assert.equal(fx.service.retrieve(fx.service.createSession({}).id, req).items.length, 0);
    }
    fx.service.setStatus(item.id, "active");
    assert.equal(fx.service.retrieve(fx.service.createSession({}).id, req).items.length, 1);
  } finally { await fx.close(); }
});

test("new sessions do not inherit application-specific fields or selections", async () => {
  const fx = await fixture(); try {
    const oldSession = fx.service.createSession({ company_name: "OldCo", job_title: "Old Role", job_description: "Old manager and team", user_instructions: "old" });
    fx.service.updateSession(oldSession.id, { selected_knowledge: ["old-id"], draft: "old draft" });
    const fresh = fx.service.createSession({});
    assert.equal(fresh.company_name, ""); assert.equal(fresh.job_title, ""); assert.equal(fresh.job_description, "");
    assert.deepEqual(fresh.selected_knowledge, []); assert.equal(fresh.draft, ""); assert.notEqual(fresh.id, oldSession.id);
  } finally { await fx.close(); }
});

test("invalid structured candidate output cannot corrupt the database", async () => {
  const fx = await fixture(); try {
    const session = fx.service.createSession({});
    assert.throws(() => fx.service.createCandidates(session.id, [{ proposed_title: "missing fields" }]), /candidate_action/);
    assert.equal(fx.repository.listCandidates(session.id).length, 0);
    assert.equal(fx.service.list({ status: "all" }).length, 0);
  } finally { await fx.close(); }
});

test("search gracefully falls back when FTS5 is unavailable", async () => {
  const fx = await fixture({ forceFtsUnavailable: true }); try {
    fx.service.createManual({ category: "achievement", title: "Analytics award", summary: "Recognized for analysis", details: {}, tags: ["Data Analytics"], source_type: "manual" });
    assert.equal(fx.service.list({ search: "analytics" }).length, 1);
    assert.equal(fx.ftsAvailable, false);
  } finally { await fx.close(); }
});

test("existing provider, generation, and PDF export paths remain wired", async () => {
  const [app, provider, exporter] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/aiProvider.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/exporter.ts", import.meta.url), "utf8")
  ]);
  assert.match(app, /providerModelMap/); assert.match(app, /generateDraft/); assert.match(app, /handleSavePdf/);
  assert.match(provider, /chatWithOllama/); assert.match(provider, /chatWithOpenAI/);
  assert.match(exporter, /save-cover-letter/); assert.match(exporter, /buildTemplateFieldsFromDraft/);
});
