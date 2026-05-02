# Chrome Extension (JD Import Side Panel)

This extension is an MVP browser-side JD import layer for the local Cover Letter Agent.

## What it does
- Reads only the current page when the user clicks `Extract JD`.
- Supports LinkedIn and Handshake hosts in this MVP.
- Shows editable preview fields.
- Sends confirmed data only to local endpoint: `http://127.0.0.1:3031/import-job`.

## What it does not do
- No crawling.
- No auto-apply.
- No job search agent behavior.
- No direct OpenAI/Gemini/Ollama API calls.

## Privacy note
The extension reads page content only after user action in the side panel. It does not collect browsing history and does not send extracted data to remote services.

## Load unpacked extension
1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked` and select this `extension/` folder.
