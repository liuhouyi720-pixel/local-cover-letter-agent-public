import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const PORT = 3031;
const DEFAULT_TEMPLATE_DOCX_PATH = "";
const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG_PATH = path.join(HELPER_DIR, "local-config.json");
const WORD_RENDER_SCRIPT = path.join(HELPER_DIR, "render-template.ps1");

function sanitizeFilenamePart(value) {
  return (value || "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function getDateString(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function maskApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.length < 8) return "";
  return `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`;
}

async function loadLocalConfig() {
  try {
    const raw = await readFile(LOCAL_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveLocalConfig(config) {
  await writeFile(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeFields(input, companyName, dateLine) {
  const fallback = {
    sender_name: "Your Name",
    sender_contact_line: "",
    sender_location_line: "",
    date_line: dateLine,
    recipient_name: "",
    recipient_company: companyName || "",
    recipient_address_lines: [],
    salutation: "Dear Hiring Manager,",
    body_paragraphs: [],
    closing_line: "Sincerely,",
    signature_name: "Your Name"
  };

  if (!input || typeof input !== "object") {
    return fallback;
  }

  const parsed = input;
  return {
    sender_name: typeof parsed.sender_name === "string" && parsed.sender_name.trim() ? parsed.sender_name.trim() : fallback.sender_name,
    sender_contact_line:
      typeof parsed.sender_contact_line === "string" && parsed.sender_contact_line.trim()
        ? parsed.sender_contact_line.trim()
        : fallback.sender_contact_line,
    sender_location_line: typeof parsed.sender_location_line === "string" ? parsed.sender_location_line.trim() : "",
    date_line: typeof parsed.date_line === "string" && parsed.date_line.trim() ? parsed.date_line.trim() : fallback.date_line,
    recipient_name:
      typeof parsed.recipient_name === "string" && parsed.recipient_name.trim() ? parsed.recipient_name.trim() : fallback.recipient_name,
    recipient_company:
      typeof parsed.recipient_company === "string" && parsed.recipient_company.trim()
        ? parsed.recipient_company.trim()
        : fallback.recipient_company,
    recipient_address_lines: isStringArray(parsed.recipient_address_lines)
      ? parsed.recipient_address_lines.map((line) => line.trim()).filter(Boolean)
      : [],
    salutation: typeof parsed.salutation === "string" && parsed.salutation.trim() ? parsed.salutation.trim() : fallback.salutation,
    body_paragraphs: isStringArray(parsed.body_paragraphs)
      ? parsed.body_paragraphs.map((line) => line.trim()).filter(Boolean).slice(0, 5)
      : [],
    closing_line: typeof parsed.closing_line === "string" && parsed.closing_line.trim() ? parsed.closing_line.trim() : fallback.closing_line,
    signature_name:
      typeof parsed.signature_name === "string" && parsed.signature_name.trim() ? parsed.signature_name.trim() : fallback.signature_name
  };
}

function buildTxtFromFields(fields) {
  const recipientLines = [fields.recipient_name, fields.recipient_company, ...fields.recipient_address_lines].filter(Boolean);
  const lines = [
    fields.sender_name,
    fields.sender_contact_line,
    fields.sender_location_line,
    "",
    fields.date_line,
    "",
    ...recipientLines,
    recipientLines.length > 0 ? "" : "",
    fields.salutation,
    "",
    ...fields.body_paragraphs,
    "",
    fields.closing_line,
    fields.signature_name
  ];
  return lines
    .filter((line, index, arr) => {
      if (line !== "") return true;
      const prev = arr[index - 1];
      return prev !== "";
    })
    .join("\n");
}

async function assertPathReadable(filePath, name) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${name} not found or not accessible: ${filePath}`);
  }
}

async function runWordTemplateExport(params) {
  const tempPayloadPath = path.join(
    os.tmpdir(),
    `cla-template-payload-${Date.now()}-${Math.round(Math.random() * 1e9)}.json`
  );

  await writeFile(tempPayloadPath, JSON.stringify(params.fields), "utf-8");

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          WORD_RENDER_SCRIPT,
          "-TemplatePath",
          params.templateDocxPath,
          "-OutputDocxPath",
          params.docxPath,
          "-OutputPdfPath",
          params.pdfPath,
          "-PayloadJsonPath",
          tempPayloadPath
        ],
        { windowsHide: true }
      );

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (error) => reject(error));
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(undefined);
          return;
        }
        reject(
          new Error(
            `Word template export failed (exit ${code}). stderr: ${stderr || "(empty)"} stdout: ${stdout || "(empty)"}`
          )
        );
      });
    });
  } finally {
    await rm(tempPayloadPath, { force: true });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function isChatMessage(value) {
  return (
    value &&
    typeof value === "object" &&
    ["system", "user", "assistant"].includes(value.role) &&
    typeof value.content === "string"
  );
}

async function chatWithOpenAI({ apiKey, model, messages }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || response.statusText || "OpenAI request failed.";
    throw new Error(`OpenAI HTTP ${response.status}: ${message}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI response did not include message content.");
  }

  return content.trim();
}

function getOpenAIApiKey(config) {
  if (typeof config.openaiApiKey === "string" && config.openaiApiKey.trim()) {
    return config.openaiApiKey.trim();
  }
  if (typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim()) {
    return process.env.OPENAI_API_KEY.trim();
  }
  return "";
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Missing URL" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, service: "cover-letter-export-helper" });
    return;
  }

  if (req.method === "GET" && req.url === "/provider-status") {
    const config = await loadLocalConfig();
    const apiKey = getOpenAIApiKey(config);
    sendJson(res, 200, {
      ok: true,
      openai: {
        configured: !!apiKey,
        maskedKey: apiKey ? maskApiKey(apiKey) : ""
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/openai-key") {
    try {
      const parsed = await readJsonBody(req);
      const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
      if (!apiKey) {
        sendJson(res, 400, { error: "OpenAI API key is required." });
        return;
      }
      if (!apiKey.startsWith("sk-")) {
        sendJson(res, 400, { error: "OpenAI API key should start with sk-." });
        return;
      }

      const config = await loadLocalConfig();
      config.openaiApiKey = apiKey;
      await saveLocalConfig(config);
      sendJson(res, 200, { ok: true, maskedKey: maskApiKey(apiKey) });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Failed to save OpenAI API key."
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/chat") {
    try {
      const parsed = await readJsonBody(req);
      const provider = parsed.provider;
      const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      if (provider !== "openai") {
        sendJson(res, 400, { error: "Only OpenAI chat is supported by this helper endpoint." });
        return;
      }
      if (!model) {
        sendJson(res, 400, { error: "OpenAI model is required." });
        return;
      }
      if (!messages.length || !messages.every(isChatMessage)) {
        sendJson(res, 400, { error: "messages must be an array of chat messages." });
        return;
      }

      const config = await loadLocalConfig();
      const apiKey = getOpenAIApiKey(config);
      if (!apiKey) {
        sendJson(res, 400, { error: "OpenAI API key is not configured. Save it in Model Settings first." });
        return;
      }

      const content = await chatWithOpenAI({ apiKey, model, messages });
      sendJson(res, 200, { ok: true, content });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "OpenAI chat request failed."
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/save-cover-letter") {
    try {
      const parsed = await readJsonBody(req);
      const coverLetter = typeof parsed.coverLetter === "string" ? parsed.coverLetter.trim() : "";
      const outputFolder = typeof parsed.outputFolder === "string" ? parsed.outputFolder.trim() : "";
      const templateDocxPath =
        typeof parsed.templateDocxPath === "string" && parsed.templateDocxPath.trim()
          ? parsed.templateDocxPath.trim()
          : DEFAULT_TEMPLATE_DOCX_PATH;
      const rawCompanyName = typeof parsed.companyName === "string" ? parsed.companyName.trim() : "";
      const company = sanitizeFilenamePart(rawCompanyName || "Company");
      const date = getDateString(parsed.date);

      if (!coverLetter) {
        sendJson(res, 400, { error: "coverLetter is required." });
        return;
      }
      if (!outputFolder) {
        sendJson(res, 400, { error: "outputFolder is required." });
        return;
      }
      if (!templateDocxPath) {
        sendJson(res, 400, { error: "templateDocxPath is required." });
        return;
      }

      await assertPathReadable(WORD_RENDER_SCRIPT, "Word render script");
      await assertPathReadable(templateDocxPath, "Template .docx");
      await mkdir(outputFolder, { recursive: true });

      const fields = normalizeFields(parsed.fields, rawCompanyName, date);
      const signer = sanitizeFilenamePart(fields.signature_name || fields.sender_name || "Applicant");
      const filenameBase = `${company || "Company"}-Cover Letter-${signer || "Applicant"}`;
      const docxPath = path.join(outputFolder, `${filenameBase}.docx`);
      const pdfPath = path.join(outputFolder, `${filenameBase}.pdf`);
      const txtPath = path.join(outputFolder, `${filenameBase}.txt`);

      await runWordTemplateExport({
        templateDocxPath,
        docxPath,
        pdfPath,
        fields
      });
      await writeFile(txtPath, buildTxtFromFields(fields), "utf-8");

      sendJson(res, 200, {
        ok: true,
        filename: `${filenameBase}.pdf`,
        pdfPath,
        docxPath,
        txtPath,
        generatedDate: date
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown export error"
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Export helper listening on http://127.0.0.1:${PORT}`);
});
