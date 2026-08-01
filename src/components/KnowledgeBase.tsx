import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createKnowledge, getKnowledgeHistory, getKnowledgeUsage, listKnowledge, setKnowledgeStatus, updateKnowledge
} from "../lib/knowledgeApi";
import { KnowledgeInput, KnowledgeItem, KNOWLEDGE_CATEGORIES, KnowledgeStatus } from "../lib/knowledgeTypes";

const EMPTY_FORM: KnowledgeInput = {
  category: "project", title: "", summary: "", details: {}, tags: [], source_type: "manual", source_reference: "", source_text: ""
};

export function KnowledgeBase(props: { onClose: () => void }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("active");
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [form, setForm] = useState<KnowledgeInput>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [usage, setUsage] = useState<Array<Record<string, string>>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems(await listKnowledge({ search, category, tag, status })); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [search, category, tag, status]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function selectItem(item: KnowledgeItem) {
    setSelected(item); setEditing(false);
    try {
      const [versions, priorUsage] = await Promise.all([getKnowledgeHistory(item.id), getKnowledgeUsage(item.id)]);
      setHistory(versions.versions as unknown as Array<Record<string, unknown>>); setUsage(priorUsage);
    } catch (err) { setError((err as Error).message); }
  }

  function startCreate() { setSelected(null); setForm(EMPTY_FORM); setEditing(true); setHistory([]); setUsage([]); }
  function startEdit(item: KnowledgeItem) {
    setSelected(item);
    setForm({ category: item.category, title: item.title, summary: item.summary, details: item.details,
      tags: item.tags.map((entry) => entry.name), source_type: item.source_type,
      source_reference: item.source_reference, source_text: item.source_text, status: item.status,
      valid_from: item.valid_from, valid_to: item.valid_to });
    setEditing(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const saved = selected ? await updateKnowledge(selected.id, { ...form, change_reason: "Edited in Knowledge Base" }) : await createKnowledge(form);
      setEditing(false); await refresh(); await selectItem(saved);
    } catch (err) { setError((err as Error).message); }
  }

  async function changeStatus(item: KnowledgeItem, next: KnowledgeStatus) {
    try { const saved = await setKnowledgeStatus(item.id, next); await refresh(); await selectItem(saved); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <section className="panel wizardPanel knowledgePage">
      <div className="knowledgeTitleRow">
        <div><p className="eyebrow">User-verified profile</p><h2>Knowledge Base</h2></div>
        <div className="row wrap"><button type="button" onClick={startCreate}>Add item</button><button type="button" onClick={props.onClose}>Back to application</button></div>
      </div>
      <p className="muted">Only information you explicitly approve is stored here and eligible for future applications.</p>
      {error && <p className="warningText">{error}</p>}
      <div className="knowledgeFilters">
        <input aria-label="Search knowledge" placeholder="Search title, summary, details" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Category filter" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{KNOWLEDGE_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select>
        <input aria-label="Tag filter" placeholder="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option>active</option><option>disabled</option><option>archived</option></select>
      </div>
      <div className="knowledgeLayout">
        <div className="knowledgeList">
          {loading && <p className="muted">Loading…</p>}
          {!loading && items.length === 0 && <p className="muted">No matching approved knowledge yet.</p>}
          {items.map((item) => <button type="button" className={`knowledgeListItem ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => void selectItem(item)}>
            <span><strong>{item.title}</strong><small>{item.category} · {item.status}</small></span><span>{item.tags.map((entry) => entry.name).slice(0, 3).join(", ")}</span>
          </button>)}
        </div>
        <div className="knowledgeDetail">
          {editing ? <form onSubmit={(event) => void submit(event)} className="knowledgeForm">
            <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as KnowledgeInput["category"] })}>{KNOWLEDGE_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
            <label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Summary<textarea required rows={5} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
            <label>Organization<input value={form.details.organization || ""} onChange={(e) => setForm({ ...form, details: { ...form.details, organization: e.target.value } })} /></label>
            <label>Role<input value={form.details.role || ""} onChange={(e) => setForm({ ...form, details: { ...form.details, role: e.target.value } })} /></label>
            <label>Skills (comma-separated)<input value={(form.details.skills || []).join(", ")} onChange={(e) => setForm({ ...form, details: { ...form.details, skills: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></label>
            <label>Tags (comma-separated)<input value={form.tags.join(", ")} onChange={(e) => setForm({ ...form, tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
            <label>Source reference<input value={form.source_reference || ""} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} /></label>
            <label>Source text<textarea rows={4} value={form.source_text || ""} onChange={(e) => setForm({ ...form, source_text: e.target.value })} /></label>
            <div className="row wrap"><button type="submit">{selected ? "Save version" : "Create approved item"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </form> : selected ? <>
            <div className="knowledgeTitleRow"><div><span className="statusPill ok">{selected.status}</span><h3>{selected.title}</h3></div><button type="button" onClick={() => startEdit(selected)}>Edit</button></div>
            <p>{selected.summary}</p>
            <p className="muted">Category: {selected.category} · Tags: {selected.tags.map((entry) => entry.name).join(", ") || "none"}</p>
            <details><summary>Structured details</summary><pre>{JSON.stringify(selected.details, null, 2)}</pre></details>
            <details><summary>Source</summary><p>{selected.source_reference || selected.source_type}</p><blockquote>{selected.source_text || "No source excerpt recorded for this manual item."}</blockquote></details>
            <div className="row wrap">
              {selected.status !== "disabled" && <button type="button" onClick={() => void changeStatus(selected, "disabled")}>Disable</button>}
              {selected.status !== "archived" && <button type="button" onClick={() => void changeStatus(selected, "archived")}>Archive</button>}
              {selected.status !== "active" && <button type="button" onClick={() => void changeStatus(selected, "active")}>Restore</button>}
            </div>
            <details><summary>Version history ({history.length})</summary>{history.map((entry) => <p key={String(entry.version_number)}>v{String(entry.version_number)} · {String(entry.change_type)} · {String(entry.created_at)}</p>)}</details>
            <details><summary>Prior usage ({usage.length})</summary>{usage.length ? usage.map((entry, index) => <p key={`${entry.id}-${index}`}>{entry.company_name} / {entry.job_title}: {entry.usage_status}</p>) : <p className="muted">Not used yet.</p>}</details>
          </> : <p className="muted">Select an item or add your first verified experience.</p>}
        </div>
      </div>
    </section>
  );
}
