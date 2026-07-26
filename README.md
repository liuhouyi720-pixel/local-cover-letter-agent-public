# Cover Letter Agent + Big Four Job Monitor

Recovery README for the two local-first workflows currently living in this
repository:

1. **AI Cover Letter Agent** - a React/Vite wizard that combines a resume, job
   description, user preferences, and optional source material to generate and
   review a cover letter.
2. **Big Four Job Monitor** - a Python pipeline that searches official career
   pages, filters early-career roles, records changes in SQLite, and exports
   review files.

They share a repository, but they are **not yet one end-to-end program**. The
monitor does not currently send a selected database job into the cover-letter
wizard.

## Recovery checkpoint

This snapshot was reviewed on **2026-07-24**.

- Active Git branch: `codex/job_searching_agent`.
- Last committed feature: Chrome side-panel JD import from LinkedIn/Handshake.
- The Python monitor, its tests, configuration, and generated recovery
  documentation are currently uncommitted working-tree changes.
- A populated local database exists at `data/jobs.db`.
- Current database status: 493 PwC jobs stored, 34 active early-career matches,
  2 successful crawl runs, and 0 closed jobs.
- Latest recorded crawl: 493 records, 0 new, 0 updated, 493 unchanged.
- No Windows Scheduled Task pointing to this project or
  `big_four_monitor` was found. The crawler works manually, but the scheduler
  is not currently installed on this machine.

Generated databases and output files are ignored by Git, so preserving the
working directory or making a separate backup is important.

## How the pieces relate

```text
Manual JD paste ───────────────────────────────┐
                                               │
LinkedIn/Handshake page                        ▼
  └─ Chrome extension ──> local helper ──> Cover Letter Agent
                          (latest JD in RAM)     (React/Vite)

PwC official careers pages
  └─ Big Four Job Monitor ──> SQLite + CSV/JSON/HTML
                               │
                               └─ no connection to the Cover Letter Agent yet
```

The Chrome extension is already a small import bridge, but it is separate from
the Python monitor. It sends only the most recently confirmed job to the local
Node helper. The helper keeps that job in memory, and the web app polls for it
while Step 2 is open.

---

## Part 1: AI Cover Letter Agent

### Purpose

The cover-letter application is a local browser wizard. Its main job is:

```text
resume + JD + preferences + optional evidence
  -> model-generated structured JSON
  -> editable cover letter + evidence/risk review
  -> TXT or Word-template DOCX/PDF
```

It supports:

- Local Ollama models, with `qwen2.5:7b-instruct` as the default.
- Optional OpenAI models through the local Node helper.
- Resume and source-file parsing from `.txt`, `.pdf`, and `.docx`.
- Manual JD paste or Chrome-extension import.
- Structured memory suggestions: facts, goals, preferences, and stories.
- Cover-letter regeneration from user feedback.
- An evidence map connecting draft sentences to resume/profile evidence.
- A red/yellow/green fit assessment with a score and recommended actions.
- Optional interview-preparation tips after the draft.
- Browser-local workflow persistence.
- TXT download and Microsoft Word template-based DOCX/PDF export.

### User workflow

#### Intake page

1. Choose Ollama or OpenAI and a model.
2. Upload the initial resume. This is required.
3. Optionally upload transcripts, papers, portfolio material, or other source
   documents.
4. Complete intake to enter the five-step pipeline.

Only extracted text and filenames are retained in browser storage; the original
uploaded binaries are not stored by the app.

#### Step 1: Writing Setup

Choose:

- Role direction: Consulting, Accounting, Data, or General.
- Tone: Professional, Natural, Confident, or Concise.
- Target length: 200, 300, or 400 words.
- Applicant identity/contact fields.
- Optional company and job title.
- Word template path and output folder for export.

#### Step 2: Job Description

Paste the JD into the text box. A minimum of 120 characters is required.

Alternatively, the Chrome extension can send a LinkedIn or Handshake job to the
helper. While Step 2 is open, the app polls the helper every two seconds and
fills:

- JD text
- company name
- job title

#### Step 3: Extra Input

Add application-specific instructions and profile notes. Optional uploaded
source material can be converted by the selected model into editable
`facts`, `goals`, `preferences`, and `stories`.

These memory fields are optional and do not block generation.

#### Step 4: Draft Review

The selected model returns strict JSON containing:

- `cover_letter`
- `evidence_map`
- `ai_suggestion`
- `missing_info_questions`

The app validates the schema and makes a second model call to repair malformed
JSON when necessary. The user can edit, copy, download, regenerate, or export
the draft.

The AI suggestion checks likely hard filters such as graduation year, major or
degree, work authorization, location/on-site requirements, and required
experience. The evidence map highlights unsupported claims for manual review.

#### Step 5: Interview Tips

Generate:

- likely interview focus areas
- JD priorities
- experiences to emphasize
- two to five interview tips

`Complete & go for next JOB` clears the current job workflow and returns to
Step 1 while preserving intake, provider settings, output folder, and template
path.

### Important behavior gap

The original development note says:

> If the JD contains a hard requirement I do not meet, tell me directly and do
> not generate a cover letter.

That requirement is **not fully implemented**. The current app asks the model
to generate the cover letter and fit assessment together. It may return a red
warning, but the draft has already been generated. A separate eligibility
preflight must be added if generation should stop before drafting.

### Cover-letter runtime architecture

| Component | Location | Responsibility |
|---|---|---|
| React wizard | `src/App.tsx` | Workflow, UI state, generation, import polling |
| Prompt builders | `src/lib/prompts.ts` | Draft, memory, repair, and interview prompts |
| Provider adapter | `src/lib/aiProvider.ts` | Routes requests to Ollama or the helper |
| Validation | `src/lib/validate.ts` | Repairs/parses model JSON and validates schema |
| File parsing | `src/lib/resumeParser.ts` | Extracts TXT, PDF, and DOCX text |
| Browser persistence | `src/lib/persistence.ts` | Saves intake/settings/memory to `localStorage` |
| Local Node helper | `tools/export-helper/server.mjs` | OpenAI proxy, API-key storage, JD import, export |
| Word renderer | `tools/export-helper/render-template.ps1` | Fills a DOCX template and exports DOCX/PDF |
| Chrome extension | `extension/` | Extracts and confirms the current job page |

The browser persistence key is `cla_mvp1_saved_state_v2`.

### Install and run the cover-letter app

Prerequisites:

- Node.js 20.19+ or a current Node.js release compatible with Vite 7.
- npm.
- Ollama for local generation, or an OpenAI API key.
- Microsoft Word on Windows only if DOCX/PDF template export is needed.

Install:

```powershell
npm install
```

For the default Ollama path:

```powershell
ollama serve
ollama pull qwen2.5:7b-instruct
```

Start the local helper in one terminal:

```powershell
npm run export-helper
```

Start the web app in another terminal:

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>.

The helper listens only on `http://127.0.0.1:3031`. It is required for OpenAI,
Chrome-extension import, and Word-template export. Ollama chat itself goes
directly from the web app to the configured Ollama URL.

#### One-click launcher

`start-cover-letter-agent.bat` starts the IPEX Ollama runtime, helper, Vite, and
browser. It is machine-specific:

- `start-ipex-ollama-gpu.bat` expects Ollama at
  `D:\AI\ollama-ipex-llm-2.3.0b20250725-win`.
- It force-stops existing `ollama.exe` and `ollama-lib.exe` processes before
  launching the IPEX build.

Use the manual terminal commands if that path or behavior is not appropriate.

### OpenAI key handling

The preferred path is to start the helper and save the key from the Intake UI.
It is written in plaintext to the ignored local file:

```text
tools/export-helper/local-config.json
```

The helper can also read `OPENAI_API_KEY` from its process environment. The
current code does **not** automatically load `.env`, so `.env.example` is a
reference file rather than an active configuration loader. Do not commit the
local config file or an API key.

### Chrome JD import

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose **Load unpacked** and select `extension/`.
4. Start `npm run export-helper`.
5. On a LinkedIn or Handshake job page, open the extension side panel.
6. Click **Extract JD**.
7. Review and edit the extracted fields.
8. Click **Send to Local Agent**.
9. Open Step 2 in the cover-letter app.

Privacy boundary:

- The extension reads the current page only after the user clicks Extract.
- It does not crawl, auto-apply, collect browsing history, or call an AI model.
- It posts confirmed fields only to the loopback helper.

The latest imported job is stored only in helper memory and is lost when the
helper restarts. The extension keeps its editable preview in Chrome local
storage.

### Export behavior

TXT download works in the browser. DOCX/PDF export requires:

- the local helper
- Microsoft Word COM automation
- a valid template `.docx` path
- a valid output folder

Token-based templates may contain:

```text
{{SENDER_NAME}}
{{SENDER_CONTACT_LINE}}
{{SENDER_LOCATION_LINE}}
{{DATE_LINE}}
{{RECIPIENT_NAME}}
{{RECIPIENT_COMPANY}}
{{RECIPIENT_ADDRESS_LINES}}
{{SALUTATION}}
{{BODY_P1}} through {{BODY_P5}}
{{CLOSING_LINE}}
{{SIGNATURE_NAME}}
```

If `{{SENDER_NAME}}` is absent, the exporter falls back to replacing the first
10 document paragraphs positionally. Token-based templates are safer.

Generated filenames use:

```text
<Company>-Cover Letter-<Signature>.docx
<Company>-Cover Letter-<Signature>.pdf
<Company>-Cover Letter-<Signature>.txt
```

---

## Part 2: Big Four Job Monitor

### Purpose

The monitor is a deterministic Python crawler and change-tracking pipeline. It
does not use an LLM.

Current MVP0 behavior:

- Reads official public PwC US search and job-detail HTML.
- Retrieves all visible search records.
- Filters for internship and early-career terms.
- Stores normalized jobs and crawl history in local SQLite.
- Retrieves full details for new/changed matching records when needed.
- Detects new, updated, unchanged, reopened, missing, and closed jobs.
- Requires a job to be absent from two successful runs before closing it.
- Fails safely on blocked, challenged, or unexpectedly empty source responses.
- Generates CSV, JSON, log, and local HTML preview files.

It does not:

- support KPMG, EY, or Deloitte yet
- log in or bypass access controls
- apply to jobs
- send email
- use a remote database
- run through GitHub Actions

Source behavior and compliance decisions are recorded in
`docs/data-source-investigation.md`.

### Monitor architecture

```text
config/
  settings.yaml                 database, outputs, timing, user agent
  firms.yaml                    enabled/disabled firm connectors

src/big_four_monitor/
  connectors/                   official-source HTTP and PwC parser
  filtering/                    deterministic early-career rules
  parsing/                      URL, text, and location normalization
  services/                     crawl, change detection, export, preview
  storage/                      SQLAlchemy schema and repository
  utils/                        logging, hashing, rate limiting, retry

tests/                          offline fixture-based tests
data/jobs.db                    generated local SQLite database
outputs/                        generated review artifacts
```

### Install and run the monitor

Python 3.11 or newer is required.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

Run from the repository root:

```powershell
python -m big_four_monitor init-db
python -m big_four_monitor crawl --firm pwc --dry-run
python -m big_four_monitor crawl --firm pwc
python -m big_four_monitor status
python -m big_four_monitor export
```

Other commands:

```powershell
python -m big_four_monitor investigate --firm pwc
python -m big_four_monitor crawl --firm all
python -m big_four_monitor notify
```

Notes:

- `--dry-run` retrieves, parses, filters, and validates without changing the
  database or outputs.
- `--firm all` currently runs PwC and reports the other firms as deferred.
- A normal crawl also regenerates the output files.
- The default two-second per-domain interval keeps requests sequential and
  low-frequency.
- Windows Task Scheduler runs the PwC monitor daily at 8:00 AM Central Time
  while the current Windows account is logged in.

### Database

Default path:

```text
data/jobs.db
```

Main tables:

| Table | Purpose |
|---|---|
| `jobs` | Current normalized job state and matching flag |
| `job_locations` | Parsed locations related to each job |
| `crawl_runs` | Run status and summary counts |
| `run_job_changes` | Per-run new/updated/active/closed records |

Example query:

```sql
SELECT firm, source_job_id, title, career_level, status, missing_run_count
FROM jobs
WHERE is_matching = 1
ORDER BY last_seen_at DESC;
```

### Generated outputs

A successful crawl or `export` writes:

- `outputs/latest_jobs.csv`
- `outputs/new_jobs.csv`
- `outputs/updated_jobs.csv`
- `outputs/run_summary.json`
- `outputs/job_monitor.log`
- `outputs/email_preview.html`

The HTML file is only a local preview. The `notify` command regenerates it but
does not send an email. SMTP names in `.env.example` are reserved and are not
read by the current monitor.

### Windows Task Scheduler

The task `Big Four US Job Monitor - Daily PwC` invokes
`scripts/run-daily-monitor.ps1` each day at 8:00 AM Central Time. It prevents
overlapping runs, starts a missed run when Windows becomes available, and
appends execution details to `outputs/scheduler.log`.

Inspect the task and log:

```powershell
Get-ScheduledTask -TaskName "Big Four US Job Monitor - Daily PwC"
Get-ScheduledTaskInfo -TaskName "Big Four US Job Monitor - Daily PwC"
Get-Content outputs\scheduler.log -Tail 50
```

The runner uses the installed Python 3.12 executable. If Python is moved or
reinstalled, update `$pythonPath` in `scripts/run-daily-monitor.ps1`.

### Filtering and safety

Target terms include intern, internship, trainee, student, campus, graduate,
early career, entry level, analyst, associate, staff, and co-op.

Senior Associate, Senior Consultant, Manager, Director, Principal, Partner, and
similar levels are excluded when they appear in the title or structured career
level.

The connector:

- uses public server-rendered pages
- does not require JavaScript, login, or an existing cookie
- rate-limits requests
- retries conservatively
- respects `Retry-After`
- detects challenge pages
- rejects unexpected zero/count-mismatch results
- does not mark every job closed after a failed source run

### Current PwC limitations

- The search list and detail page expose different forms of job ID.
- Posted date and application deadline were not confirmed and remain null.
- Service line and Apply URL require a detail-page fetch.
- Public HTML selectors may change.
- Fixture tests protect known behavior but do not guarantee the live site has
  not changed.

---

## What is not integrated

The following connection does not exist:

```text
job selected from data/jobs.db
  -> company/title/location/JD sent to the web app
  -> cover-letter workflow opened for that job
```

Specific missing pieces:

- No UI in the cover-letter app for browsing monitor database jobs.
- No API endpoint for listing or selecting SQLite jobs.
- No monitor-to-helper import command.
- No persistent import queue; the helper stores one latest imported job in RAM.
- No shared application-status table linking a job to a draft or exported
  letter.
- No installed daily scheduler.
- No email delivery.
- No automatic eligibility preflight that blocks drafting.

The monitor and cover-letter app also use different state stores:

- Cover-letter settings and extracted personal text: browser `localStorage`.
- OpenAI key: helper local JSON file or helper process environment.
- Extension preview: Chrome local storage.
- Latest extension import: helper memory.
- Job-monitor records: SQLite.
- Generated cover letters: user-selected output folder.

## Recommended integration order

1. **Protect the current work.** Review and commit the Python monitor,
   configuration, tests, and this README before adding more features.
2. **Make scheduling explicit.** Add a checked-in Windows wrapper script that
   activates the intended Python environment, sets the repository working
   directory, runs `crawl --firm pwc`, and writes a durable scheduler log. Then
   register and verify the Scheduled Task.
3. **Persist the import bridge.** Replace the helper's in-memory
   `latestImportedJob` with a small persistent queue or read directly from
   SQLite.
4. **Add job selection.** Expose active matching monitor jobs through a local
   API and add a “Use in Cover Letter Agent” action.
5. **Map fields.** Send title, firm/company, location, description, detail URL,
   and apply URL into Step 2 and the application record.
6. **Add eligibility preflight.** Run hard-requirement analysis before the
   drafting call; block generation on a confirmed fatal mismatch and show the
   reason.
7. **Track application state.** Link selected job IDs to draft/export paths and
   statuses such as reviewing, drafting, applied, rejected, or archived.
8. **Expand sources only after the bridge is stable.** Add KPMG, EY, and
   Deloitte connectors one at a time with source investigation and fixtures.

## Development and verification

Frontend build:

```powershell
npm run build
```

Monitor tests:

```powershell
pytest
```

Useful helper health check after starting it:

```powershell
Invoke-RestMethod http://127.0.0.1:3031/health
Invoke-RestMethod http://127.0.0.1:3031/provider-status
```

Useful monitor status check:

```powershell
python -m big_four_monitor status
```

Do not use a live crawl as an ordinary unit test. The saved fixtures under
`tests/fixtures/` are intended for repeatable offline testing.

## Troubleshooting

### Cover-letter app

- **Cannot reach local helper:** run `npm run export-helper` and check
  `http://127.0.0.1:3031/health`.
- **Cannot reach Ollama:** start Ollama and confirm the base URL in Settings.
- **Ollama model not found:** pull the selected model.
- **OpenAI key not configured:** start the helper and save the key in Intake,
  or set `OPENAI_API_KEY` in the helper process environment.
- **Imported JD does not appear:** keep the helper running, send the job again,
  and open Step 2. Imports do not survive a helper restart.
- **DOCX/PDF export fails:** verify Microsoft Word, template path, output
  folder, helper, and template tokens.
- **Old personal data appears:** use **Clear Saved Data** in the app or remove
  the `cla_mvp1_saved_state_v2` localStorage entry.

### Job monitor

- **Earlier prototype schema:** preserve/rename the old `data/jobs.db`, then run
  `init-db`. Do not delete a database without a backup.
- **403 or challenge page:** stop and try a later low-frequency run. The
  connector does not evade controls.
- **429:** allow the conservative retry logic and `Retry-After` handling to
  work; do not increase crawl frequency.
- **Unexpected zero results/count mismatch:** treat the run as failed and
  inspect the live page plus saved selectors before retrying.
- **Parser failure after a site redesign:** update fixtures and selectors before
  resuming normal scheduled runs.

## Security and privacy

- Never commit `tools/export-helper/local-config.json`.
- Never commit resumes, source materials, generated cover letters, or API keys.
- The OpenAI key is locally stored in plaintext when saved through the helper.
- Ollama requests remain local; OpenAI requests leave the machine through the
  OpenAI API.
- The monitor reads public job pages only and never follows through with an
  application.
- Review every generated letter and every eligibility recommendation manually.
