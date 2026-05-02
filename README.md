# Cover Letter Agent (Local-First MVP)

A local-first cover-letter workflow with:
- guided multi-step intake and drafting UI
- Ollama support (default)
- optional OpenAI support via local helper
- local PDF/DOCX/TXT export through Word template automation

## Privacy & Security
- Never commit `tools/export-helper/local-config.json`.
- Rotate/revoke any previously exposed API keys before publishing.
- This project stores sensitive settings locally on your machine.
- Bring your own resume, source materials, and template files.

## Prerequisites
- Node.js 18+
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
