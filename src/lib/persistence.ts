import { StructuredMemory, isStructuredMemory } from "./memory";
import { ModelProvider } from "./aiProvider";

export type ProviderModelMap = {
  ollama: string;
  openai: string;
};

export type SavedAppState = {
  intakeCompleted: boolean;
  initialResumeText: string;
  resumeText: string;
  resumeFileName: string;
  profileText: string;
  sourceDocumentsText: string;
  sourceDocumentNames: string[];
  selectedTemplate: "Consulting" | "Accounting" | "Data" | "General";
  tone: "Professional" | "Natural" | "Confident" | "Concise";
  length: "200" | "300" | "400";
  selectedProvider: ModelProvider;
  providerModelMap: ProviderModelMap;
  modelName: string;
  ollamaBaseUrl: string;
  openaiModelName: string;
  openaiConfigured: boolean;
  autoMemoryPrefilled: boolean;
  templateDocxPath: string;
  outputFolder: string;
  companyName: string;
  jobTitle: string;
  applicantName: string;
  applicantContactLine: string;
  applicantLocationLine: string;
  signatureName: string;
  approvedMemory: StructuredMemory;
  applicationSessionId: string;
};

const STORAGE_KEY = "cla_mvp1_saved_state_v2";

export function loadSavedState(): Partial<SavedAppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SavedAppState>;
    if (!parsed || typeof parsed !== "object") return {};

    if (parsed.approvedMemory !== undefined && !isStructuredMemory(parsed.approvedMemory)) {
      delete parsed.approvedMemory;
    }
    if (
      parsed.providerModelMap !== undefined &&
      (!parsed.providerModelMap ||
        typeof parsed.providerModelMap !== "object" ||
        typeof parsed.providerModelMap.ollama !== "string" ||
        typeof parsed.providerModelMap.openai !== "string")
    ) {
      delete parsed.providerModelMap;
    }
    if (parsed.sourceDocumentNames !== undefined && !Array.isArray(parsed.sourceDocumentNames)) {
      delete parsed.sourceDocumentNames;
    }

    return parsed;
  } catch {
    return {};
  }
}

export function saveState(state: SavedAppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearSavedState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
