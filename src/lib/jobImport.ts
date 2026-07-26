export type ImportedJobSource = "linkedin" | "handshake" | "generic";

export type ImportedJob = {
  source: ImportedJobSource;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  importedAt: string;
};

type ImportLatestResponse = {
  ok?: boolean;
  job?: unknown;
  error?: string;
};

const EXPORT_HELPER_URL = "http://127.0.0.1:3031";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseImportedJob(input: unknown): ImportedJob {
  if (!input || typeof input !== "object") {
    throw new Error("Imported job payload is invalid.");
  }

  const record = input as Record<string, unknown>;
  const source = readString(record.source).toLowerCase();
  if (source !== "linkedin" && source !== "handshake" && source !== "generic") {
    throw new Error("Imported job source is invalid.");
  }

  const job = {
    source,
    title: readString(record.title),
    company: readString(record.company),
    location: readString(record.location),
    description: readString(record.description),
    url: readString(record.url),
    importedAt: readString(record.importedAt)
  } as ImportedJob;

  if (!job.title || !job.company || !job.location || !job.description || !job.url || !job.importedAt) {
    throw new Error("Imported job is missing required fields.");
  }

  return job;
}

export async function loadLatestImportedJob(): Promise<ImportedJob | null> {
  let response: Response;

  try {
    response = await fetch(`${EXPORT_HELPER_URL}/import-job/latest`);
  } catch {
    throw new Error(
      "Cannot reach local helper (http://127.0.0.1:3031). Start it with `npm run export-helper` to sync imported jobs."
    );
  }

  const data = (await response.json()) as ImportLatestResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Import endpoint HTTP ${response.status}`);
  }

  if (data.job === null || data.job === undefined) {
    return null;
  }

  return parseImportedJob(data.job);
}
