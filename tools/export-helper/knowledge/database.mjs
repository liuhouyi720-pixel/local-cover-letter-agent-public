import Database from "better-sqlite3";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.join(MODULE_DIR, "..", "data", "personal-knowledge.sqlite");

export function resolveDatabasePath(override) {
  return path.resolve(override || process.env.PERSONAL_KNOWLEDGE_DB_PATH || DEFAULT_DB_PATH);
}

export async function openKnowledgeDatabase(options = {}) {
  const databasePath = resolveDatabasePath(options.databasePath);
  if (databasePath !== ":memory:") await mkdir(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");

  const migrationDir = path.join(MODULE_DIR, "migrations");
  const files = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const apply = db.transaction((version, sql) => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
  });
  for (const file of files) {
    if (!applied.get(file)) apply(file, await readFile(path.join(migrationDir, file), "utf8"));
  }

  let ftsAvailable = false;
  if (!options.forceFtsUnavailable) {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        knowledge_item_id UNINDEXED, title, summary, searchable_details, tags
      )`);
      ftsAvailable = true;
    } catch {
      ftsAvailable = false;
    }
  }
  return { db, databasePath, ftsAvailable };
}
