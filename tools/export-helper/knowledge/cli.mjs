import { openKnowledgeDatabase } from "./database.mjs";
import { KnowledgeRepository } from "./repository.mjs";

const command = process.argv[2] || "info";
const opened = await openKnowledgeDatabase();
const repository = new KnowledgeRepository(opened.db, { ftsAvailable: opened.ftsAvailable });

try {
  if (command === "migrate") {
    console.log(JSON.stringify({ ok: true, databasePath: opened.databasePath, ftsAvailable: opened.ftsAvailable }, null, 2));
  } else if (command === "pending") {
    const rows = opened.db.prepare(`SELECT id, application_session_id, proposed_category, proposed_title, candidate_action,
      source_reference, created_at FROM memory_candidates WHERE status = 'pending' ORDER BY created_at`).all();
    console.log(JSON.stringify({ databasePath: opened.databasePath, pending: rows }, null, 2));
  } else if (command === "reset-dev") {
    const explicitlyDevelopment = /(^|[\\/.])(dev|test)([\\/._-]|$)/i.test(opened.databasePath);
    if (!process.argv.includes("--confirm") || !explicitlyDevelopment || process.env.NODE_ENV === "production") {
      throw new Error("Refusing reset. Use a database path containing 'dev' or 'test', set PERSONAL_KNOWLEDGE_DB_PATH, and pass --confirm.");
    }
    opened.db.transaction(() => {
      for (const table of ["knowledge_usage", "memory_candidates", "application_sessions", "knowledge_versions",
        "knowledge_item_tags", "knowledge_tags", "personal_knowledge_items"]) opened.db.prepare(`DELETE FROM ${table}`).run();
      if (opened.ftsAvailable) opened.db.prepare("DELETE FROM knowledge_fts").run();
    })();
    console.log(JSON.stringify({ ok: true, reset: opened.databasePath }, null, 2));
  } else {
    const counts = Object.fromEntries(["personal_knowledge_items", "memory_candidates", "application_sessions", "knowledge_versions"]
      .map((table) => [table, opened.db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value]));
    console.log(JSON.stringify({ databasePath: opened.databasePath, ftsAvailable: opened.ftsAvailable, counts }, null, 2));
  }
} finally {
  opened.db.close();
}
