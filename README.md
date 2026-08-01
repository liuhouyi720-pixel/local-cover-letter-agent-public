# Cover Letter Agent (Local-First MVP)

A local-first cover-letter workflow with:
- guided multi-step intake and drafting UI
- Ollama support (default)
- optional OpenAI support via local helper
- local PDF/DOCX/TXT export through Word template automation
- a persistent, user-verified SQLite personal knowledge base

## Current Architecture

- **Frontend:** Vite + React + TypeScript. There is no client router or global state package; `App.tsx` owns the five-step wizard state with React hooks. `KnowledgeBase.tsx` is a dedicated library view.
- **Local service:** the existing Node HTTP helper on `127.0.0.1:3031` handles OpenAI requests, browser-extension JD imports, Word/PDF export, and the knowledge API.
- **Providers:** Ollama is called directly from the browser. OpenAI is called through the helper so the key remains in ignored local configuration. Provider choice and model settings remain in browser storage.
- **Prompts:** cover-letter and interview prompts live in `src/lib/prompts.ts`; job parsing, candidate extraction, duplicate classification, reranking, planning, and post-edit proposal prompts are separated in `src/lib/knowledgePrompts.ts`.
- **Persistence:** reusable, approved personal knowledge and isolated application sessions use SQLite. UI/settings and legacy workflow state remain in `localStorage`; legacy memory is not silently migrated or treated as verified SQLite knowledge.
- **Export:** `POST /save-cover-letter` invokes `render-template.ps1`, which automates Microsoft Word to create DOCX/PDF, and also writes a TXT copy.

There is one local service and no vector database, embedding model, training, fine-tuning, LangChain, or LlamaIndex dependency.

## Incremental Knowledge Workflow

1. Start with an empty profile or optionally import a resume/source files.
2. Imports produce pending candidates only. They do not create permanent knowledge.
3. A job description is parsed into requirements and stored only in its application session.
4. Active, user-verified knowledge is retrieved with metadata plus SQLite FTS5 (or a SQL fallback), then a limited evidence pool is reranked by the selected model.
5. Supplementary application information is converted into atomic candidates with preserved source excerpts.
6. Review and edit each candidate. “Use in this cover letter” and “Save to my knowledge base” are independent choices.
7. Approval writes the item, tags, version snapshot, and candidate decision in one transaction. Rejection never changes permanent knowledge.
8. The evidence selector and content plan determine the only approved personal evidence sent to cover-letter generation. The current uploaded resume remains current-session evidence and is never automatically saved.
9. Generation returns an internal sentence-to-source mapping. Generated prose is never learned automatically.

Disabled and archived items are excluded from retrieval. The Knowledge Base view supports search, category/tag/status filters, manual creation, editing, source inspection, status changes, version history, and usage history.

## SQLite Data Model

The migration creates:

- `personal_knowledge_items`: verified facts and structured details
- `knowledge_tags` and `knowledge_item_tags`: normalized typed tags
- `application_sessions`: isolated company/JD/instructions/selection/draft state
- `memory_candidates`: unapproved proposals and their exact source text
- `knowledge_versions`: immutable snapshots for every approved create/update/status change
- `knowledge_usage`: retrieved, recommended, selected, used, removed, and not-used events
- `profiles`: a stable profile boundary, initially using one local profile

Migrations are ordered SQL files in `tools/export-helper/knowledge/migrations/` and are applied transactionally when the helper or migration command starts. Applied filenames are recorded in `schema_migrations`; tables are never destructively recreated.

The default database is under the ignored `tools/export-helper/data/` directory. Override it without hardcoded machine paths:

```powershell
$env:PERSONAL_KNOWLEDGE_DB_PATH="D:\private-data\cover-letter-knowledge.sqlite"
npm run knowledge:migrate
```

## Knowledge Developer Commands

```bash
npm run knowledge:migrate  # apply migrations and report FTS availability
npm run knowledge:info     # inspect database location and entity counts
npm run knowledge:inspect  # list pending candidates without changing them
npm test                   # transactional/service regression tests
npm run typecheck          # TypeScript checking
npm run build              # production build
```

Development reset is intentionally guarded. It refuses the normal user database and production mode. Point to a database path containing `dev` or `test`, then run:

```powershell
$env:PERSONAL_KNOWLEDGE_DB_PATH="D:\private-data\cover-letter-dev.sqlite"
npm run knowledge:reset-dev
```

This removes only knowledge/application rows from that explicitly named development database; it does not delete the database file, settings, templates, or exported letters.

## Privacy & Security
- Never commit `tools/export-helper/local-config.json`.
- Rotate/revoke any previously exposed API keys before publishing.
- This project stores sensitive settings locally on your machine.
- Bring your own resume, source materials, and template files.
- Pending source text and approval history stay in the local SQLite database. Only the limited evidence pool needed for a task is sent to the selected model.
- Ollama keeps model processing local. Choosing OpenAI sends the current structured request and selected evidence to OpenAI.
- Raw supplements, job descriptions, and generated cover letters never become permanent personal knowledge automatically.

## Prerequisites
- Node.js 20+ (required by the native SQLite driver)
- npm
- Optional: Ollama (`ollama serve`)
- Optional: Microsoft Word (for DOCX/PDF template export in helper)

## Install
```bash
npm install
```

## Environment
Copy `.env.example` to `.env` and set what you need:

- `OPENAI_API_KEY=` optional fallback if not saved in local helper config
- `OLLAMA_BASE_URL=http://localhost:11434`
- `DEFAULT_TEMPLATE_DOCX_PATH=` optional convenience value

## Run
Terminal 1 (helper):
```bash
npm run export-helper
```

Terminal 2 (frontend):
```bash
npm run dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

### Chrome Extension (JD Import Side Panel)
- Extension files live in `extension/`.
- In Chrome, open `chrome://extensions`, enable Developer Mode, then click `Load unpacked` and select the `extension/` folder.
- On LinkedIn or Handshake job pages, open the extension side panel and use `Extract JD`, review/edit fields, then `Send to Local Agent`.
- The app polls `GET /import-job/latest` during Step 2 and auto-fills JD, company, and title for new imports.

Privacy note:
- The extension reads only the current page after explicit user action (`Extract JD`).
- It does not crawl, auto-apply, or call model APIs directly.
- It sends extracted data only to `http://127.0.0.1:3031/import-job`.

Optional Ollama terminal:
```bash
ollama serve
```

## Build
```bash
npm run build
```

There is currently no repository lint or formatting command. Type checking is part of `npm run build` and is also available separately with `npm run typecheck`.

## App Notes
- Intake and settings are persisted in browser storage (`localStorage`).
- Applicant identity fields are user-configurable in Step 1.
- Template DOCX path is blank by default and must be user-provided for export.
- OpenAI key can be saved locally in ignored helper config, or supplied by `OPENAI_API_KEY`.

## Export Behavior
- Start helper first with `npm run export-helper`.
- Export endpoint writes files to your chosen output folder.
- Filename is based on company + signature name.

## Troubleshooting
- `Cannot reach local export helper`: start `npm run export-helper` and verify `http://127.0.0.1:3031/health`.
- `OpenAI API key is not configured`: save one in the app or set `OPENAI_API_KEY`.
- `Template .docx path is required`: provide a valid local path in Step 1.
- `model not found` (Ollama): pull a model, then retry.
