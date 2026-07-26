import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { WizardStepper } from "./components/WizardStepper";
import { downloadTextFile } from "./lib/download";
import { buildTemplateFieldsFromDraft, saveCoverLetterWithHelper } from "./lib/exporter";
import { parseAndValidateInterviewTips, InterviewTips } from "./lib/interview";
import {
  chatWithProvider,
  loadProviderStatus,
  ModelProvider,
  ProviderConfig,
  saveOpenAIKey
} from "./lib/aiProvider";
import {
  cloneMemory,
  EMPTY_MEMORY,
  memoryIsEmpty,
  parseAndValidateMemory,
  serializeMemoryForPrompt,
  StructuredMemory
} from "./lib/memory";
import { clearSavedState, loadSavedState, saveState } from "./lib/persistence";
import {
  buildFixInterviewJsonPrompt,
  buildFixJsonPrompt,
  buildFixMemoryJsonPrompt,
  buildInterviewTipsSystemPrompt,
  buildInterviewTipsUserPrompt,
  buildMemorySystemPrompt,
  buildMemoryUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  LengthOption,
  RoleTemplateOption,
  ToneOption
} from "./lib/prompts";
import { extractTextFromFile } from "./lib/resumeParser";
import { CoverLetterResult, tryParseAndValidate } from "./lib/validate";
import "./App.css";

const DEFAULT_PROVIDER: ModelProvider = "ollama";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TEMPLATE_DOCX_PATH = "";
const MIN_JD_LENGTH = 120;
const STEP_TRANSITION_MS = 180;

const MODEL_OPTIONS: Record<ModelProvider, string[]> = {
  ollama: ["qwen2.5:7b-instruct", "llama3.1:8b-instruct", "mistral:7b-instruct"],
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]
};

type AppMode = "intake" | "pipeline";

type ProviderModelMap = {
  ollama: string;
  openai: string;
};

const STEPS = [
  { id: 1, title: "Writing Setup" },
  { id: 2, title: "Job Description" },
  { id: 3, title: "Extra Input" },
  { id: 4, title: "Draft Review" },
  { id: 5, title: "Interview Tips" }
] as const;

const SYSTEM_PROMPT = buildSystemPrompt();
const MEMORY_SYSTEM_PROMPT = buildMemorySystemPrompt();
const INTERVIEW_SYSTEM_PROMPT = buildInterviewTipsSystemPrompt();

const MEMORY_CATEGORIES: Array<keyof StructuredMemory> = ["facts", "goals", "preferences", "stories"];

const MEMORY_LABELS: Record<keyof StructuredMemory, string> = {
  facts: "Facts",
  goals: "Goals",
  preferences: "Preferences",
  stories: "Stories"
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferCompanyFromDraft(draft: string): string {
  const match = draft.match(/Dear Hiring Manager(?: at)?\s+([^,\n]+)/i);
  return match?.[1]?.trim() || "";
}

function inferCompanyFromJd(jd: string): string {
  const compact = jd.replace(/\s+/g, " ").trim();
  const labeled = compact.match(/(?:Company|Employer|Organization)\s*[:\-]\s*([^,.;|\n]+)/i);
  if (labeled?.[1]) return labeled[1].trim();

  const contextual = compact.match(/\b(?:at|with|for)\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5})/);
  return contextual?.[1]?.trim() || "";
}

function defaultProviderModelMap(): ProviderModelMap {
  return {
    ollama: DEFAULT_OLLAMA_MODEL,
    openai: DEFAULT_OPENAI_MODEL
  };
}

function App() {
  const [appMode, setAppMode] = useState<AppMode>("intake");
  const [currentStep, setCurrentStep] = useState<number>(1);

  const [roleTemplate, setRoleTemplate] = useState<RoleTemplateOption | "">("");
  const [tone, setTone] = useState<ToneOption | "">("");
  const [length, setLength] = useState<LengthOption | "">("");

  const [jdText, setJdText] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [profileText, setProfileText] = useState("");
  const [generationFeedback, setGenerationFeedback] = useState("");

  const [resumeText, setResumeText] = useState("");
  const [resumeFileName, setResumeFileName] = useState("");
  const [sourceDocumentsText, setSourceDocumentsText] = useState("");
  const [sourceDocumentNames, setSourceDocumentNames] = useState<string[]>([]);
  const [intakeCompleted, setIntakeCompleted] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  const [templateDocxPath, setTemplateDocxPath] = useState(DEFAULT_TEMPLATE_DOCX_PATH);
  const [applicantName, setApplicantName] = useState("");
  const [applicantContactLine, setApplicantContactLine] = useState("");
  const [applicantLocationLine, setApplicantLocationLine] = useState("");
  const [signatureName, setSignatureName] = useState("");

  const [selectedProvider, setSelectedProvider] = useState<ModelProvider>(DEFAULT_PROVIDER);
  const [providerModelMap, setProviderModelMap] = useState<ProviderModelMap>(defaultProviderModelMap());
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [maskedOpenaiKey, setMaskedOpenaiKey] = useState("");
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [checkingProviderStatus, setCheckingProviderStatus] = useState(false);
  const [savingOpenaiKey, setSavingOpenaiKey] = useState(false);

  const [memoryDraft, setMemoryDraft] = useState<StructuredMemory>(cloneMemory(EMPTY_MEMORY));
  const [autoMemoryPrefilled, setAutoMemoryPrefilled] = useState(false);

  const [coverLetterResult, setCoverLetterResult] = useState<CoverLetterResult | null>(null);
  const [draftText, setDraftText] = useState("");
  const [interviewTips, setInterviewTips] = useState<InterviewTips | null>(null);
  const [lastDraftKey, setLastDraftKey] = useState("");
  const [lastTipsKey, setLastTipsKey] = useState("");

  const [rawOutput, setRawOutput] = useState("");
  const [rawMemoryOutput, setRawMemoryOutput] = useState("");
  const [rawInterviewOutput, setRawInterviewOutput] = useState("");

  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingInterviewTips, setLoadingInterviewTips] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [autoPrefillingMemory, setAutoPrefillingMemory] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("");

  const [hasHydrated, setHasHydrated] = useState(false);
  const [isSideRailOpen, setIsSideRailOpen] = useState(false);
  const [stepTransitionPhase, setStepTransitionPhase] = useState<"idle" | "out" | "in">("idle");
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [showStep3Validation, setShowStep3Validation] = useState(false);
  const [isGeneratingFromStep3, setIsGeneratingFromStep3] = useState(false);

  const selectedModel = useMemo(() => {
    return providerModelMap[selectedProvider] || MODEL_OPTIONS[selectedProvider][0];
  }, [providerModelMap, selectedProvider]);

  const jdIsValid = jdText.trim().length >= MIN_JD_LENGTH;
  const setupComplete = !!roleTemplate && !!tone && !!length;
  const selectedProviderReady = selectedProvider === "ollama" || openaiConfigured;

  const generationBlockingItems = useMemo(() => {
    const items: Array<{ step: number; message: string }> = [];
    if (!intakeCompleted) items.push({ step: 0, message: "Complete Intake first (API + initial resume)." });
    if (!resumeText.trim()) items.push({ step: 0, message: "Initial resume text is missing. Re-upload in Intake." });
    if (!roleTemplate) items.push({ step: 1, message: "Step 1: Select Role Direction." });
    if (!tone) items.push({ step: 1, message: "Step 1: Select Tone." });
    if (!length) items.push({ step: 1, message: "Step 1: Select Target Length." });
    if (!jdIsValid) items.push({ step: 2, message: `Step 2: Job Description needs at least ${MIN_JD_LENGTH} characters.` });
    if (selectedProvider === "openai" && !openaiConfigured) {
      items.push({ step: 0, message: "OpenAI selected but API key is not configured in Intake." });
    }
    return items;
  }, [intakeCompleted, resumeText, roleTemplate, tone, length, jdIsValid, selectedProvider, openaiConfigured]);

  const canGenerateDraft = generationBlockingItems.length === 0;

  const providerConfig = useMemo<ProviderConfig>(() => {
    if (selectedProvider === "openai") {
      return { provider: "openai", model: selectedModel || DEFAULT_OPENAI_MODEL };
    }
    return {
      provider: "ollama",
      baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
      model: selectedModel || DEFAULT_OLLAMA_MODEL
    };
  }, [selectedProvider, selectedModel, baseUrl]);

  const canAccessStep = useCallback((step: number) => {
    if (appMode !== "pipeline") return false;
    if (step <= 1) return true;
    if (step === 2) return setupComplete;
    if (step === 3) return jdIsValid;
    if (step === 4) return !!draftText.trim();
    if (step === 5) return !!draftText.trim();
    return false;
  }, [appMode, setupComplete, jdIsValid, draftText]);

  const draftKey = useMemo(
    () =>
      JSON.stringify({
        provider: selectedProvider,
        model: selectedModel,
        roleTemplate,
        tone,
        length,
        jdText: jdText.trim(),
        resume: resumeText.trim(),
        profile: profileText.trim(),
        memory: memoryDraft,
        companyName: companyName.trim(),
        jobTitle: jobTitle.trim(),
        extraInstructions: extraInstructions.trim()
      }),
    [
      selectedProvider,
      selectedModel,
      roleTemplate,
      tone,
      length,
      jdText,
      resumeText,
      profileText,
      memoryDraft,
      companyName,
      jobTitle,
      extraInstructions
    ]
  );

  const tipsKey = useMemo(
    () =>
      JSON.stringify({
        provider: selectedProvider,
        model: selectedModel,
        jdText: jdText.trim(),
        resume: resumeText.trim(),
        companyName: companyName.trim(),
        jobTitle: jobTitle.trim(),
        draftText: draftText.trim()
      }),
    [selectedProvider, selectedModel, jdText, resumeText, companyName, jobTitle, draftText]
  );

  useEffect(() => {
    const saved = loadSavedState();
    const initialMap = defaultProviderModelMap();
    const savedMap = saved.providerModelMap
      ? {
          ollama: saved.providerModelMap.ollama || initialMap.ollama,
          openai: saved.providerModelMap.openai || initialMap.openai
        }
      : {
          ollama: typeof saved.modelName === "string" ? saved.modelName : initialMap.ollama,
          openai: typeof saved.openaiModelName === "string" ? saved.openaiModelName : initialMap.openai
        };

    setProviderModelMap(savedMap);
    if (saved.selectedProvider === "ollama" || saved.selectedProvider === "openai") {
      setSelectedProvider(saved.selectedProvider);
    }
    if (typeof saved.ollamaBaseUrl === "string" && saved.ollamaBaseUrl.trim()) {
      setBaseUrl(saved.ollamaBaseUrl);
    }
    if (typeof saved.openaiConfigured === "boolean") {
      setOpenaiConfigured(saved.openaiConfigured);
    }

    if (typeof saved.resumeText === "string") setResumeText(saved.resumeText);
    if (typeof saved.initialResumeText === "string" && saved.initialResumeText.trim()) {
      setResumeText(saved.initialResumeText);
    }
    if (typeof saved.resumeFileName === "string") setResumeFileName(saved.resumeFileName);
    if (typeof saved.profileText === "string") setProfileText(saved.profileText);
    if (typeof saved.sourceDocumentsText === "string") setSourceDocumentsText(saved.sourceDocumentsText);
    if (Array.isArray(saved.sourceDocumentNames)) setSourceDocumentNames(saved.sourceDocumentNames);
    if (typeof saved.intakeCompleted === "boolean") {
      setIntakeCompleted(saved.intakeCompleted);
      setAppMode(saved.intakeCompleted ? "pipeline" : "intake");
    } else {
      setAppMode("intake");
    }

    if (saved.selectedTemplate) setRoleTemplate(saved.selectedTemplate);
    if (saved.tone) setTone(saved.tone);
    if (saved.length) setLength(saved.length);
    if (typeof saved.outputFolder === "string") setOutputFolder(saved.outputFolder);
    if (typeof saved.companyName === "string") setCompanyName(saved.companyName);
    if (typeof saved.jobTitle === "string") setJobTitle(saved.jobTitle);
    if (typeof saved.templateDocxPath === "string" && saved.templateDocxPath.trim()) {
      setTemplateDocxPath(saved.templateDocxPath);
    }
    if (typeof saved.applicantName === "string") setApplicantName(saved.applicantName);
    if (typeof saved.applicantContactLine === "string") setApplicantContactLine(saved.applicantContactLine);
    if (typeof saved.applicantLocationLine === "string") setApplicantLocationLine(saved.applicantLocationLine);
    if (typeof saved.signatureName === "string") setSignatureName(saved.signatureName);
    if (saved.approvedMemory) setMemoryDraft(cloneMemory(saved.approvedMemory));
    if (typeof saved.autoMemoryPrefilled === "boolean") setAutoMemoryPrefilled(saved.autoMemoryPrefilled);

    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    saveState({
      intakeCompleted,
      initialResumeText: resumeText,
      resumeText,
      resumeFileName,
      profileText,
      sourceDocumentsText,
      sourceDocumentNames,
      selectedTemplate: (roleTemplate || "General") as RoleTemplateOption,
      tone: (tone || "Professional") as ToneOption,
      length: (length || "300") as LengthOption,
      selectedProvider,
      providerModelMap,
      modelName: providerModelMap.ollama,
      openaiModelName: providerModelMap.openai,
      ollamaBaseUrl: baseUrl,
      openaiConfigured,
      templateDocxPath,
      outputFolder,
      companyName,
      jobTitle,
      applicantName,
      applicantContactLine,
      applicantLocationLine,
      signatureName,
      autoMemoryPrefilled,
      approvedMemory: cloneMemory(memoryDraft)
    });
  }, [
    hasHydrated,
    intakeCompleted,
    resumeText,
    resumeFileName,
    profileText,
    sourceDocumentsText,
    sourceDocumentNames,
    roleTemplate,
    tone,
    length,
    selectedProvider,
    providerModelMap,
    baseUrl,
    openaiConfigured,
    templateDocxPath,
    outputFolder,
    companyName,
    jobTitle,
    applicantName,
    applicantContactLine,
    applicantLocationLine,
    signatureName,
    autoMemoryPrefilled,
    memoryDraft
  ]);

  useEffect(() => {
    if (canGenerateDraft) {
      setShowValidationDialog(false);
      setShowStep3Validation(false);
    }
  }, [canGenerateDraft]);

  const goToStep = useCallback((nextStep: number) => {
    if (appMode !== "pipeline") return;
    if (nextStep === currentStep) return;
    if (nextStep < 1 || nextStep > STEPS.length) return;
    setPendingStep(nextStep);
    setStepTransitionPhase("out");
  }, [appMode, currentStep]);

  useEffect(() => {
    if (stepTransitionPhase !== "out" || pendingStep === null) return;
    const timer = window.setTimeout(() => {
      setCurrentStep(pendingStep);
      setPendingStep(null);
      setStepTransitionPhase("in");
    }, STEP_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [stepTransitionPhase, pendingStep]);

  useEffect(() => {
    if (stepTransitionPhase !== "in") return;
    const timer = window.setTimeout(() => setStepTransitionPhase("idle"), STEP_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [stepTransitionPhase]);

  useEffect(() => {
    if (!isSideRailOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isSideRailOpen]);

  useEffect(() => {
    if (!hasHydrated) return;
    let cancelled = false;
    setCheckingProviderStatus(true);
    loadProviderStatus(baseUrl.trim() || DEFAULT_BASE_URL)
      .then((status) => {
        if (cancelled) return;
        setOllamaAvailable(status.ollama.available);
        setOpenaiConfigured(status.openai.configured);
        setMaskedOpenaiKey(status.openai.maskedKey || "");
      })
      .catch(() => {
        if (cancelled) return;
        setOllamaAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingProviderStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, baseUrl]);

  useEffect(() => {
    if (appMode !== "pipeline") return;
    if (currentStep !== 3) return;
    if (autoMemoryPrefilled) return;
    if (!sourceDocumentsText.trim()) return;
    void runAutoMemoryPrefill(sourceDocumentsText, "step3-entry");
  }, [appMode, currentStep, autoMemoryPrefilled, sourceDocumentsText]);

  function showStatus(message: string) {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(""), 2400);
  }

  function ensureSelectedProviderReady(): boolean {
    if (selectedProvider === "openai" && !openaiConfigured) {
      setError("OpenAI is selected but no API key is configured. Complete API binding in Intake.");
      return false;
    }
    return true;
  }

  function updateSelectedModel(model: string) {
    setProviderModelMap((prev) => ({ ...prev, [selectedProvider]: model }));
  }

  async function refreshProviderStatus() {
    setCheckingProviderStatus(true);
    try {
      const status = await loadProviderStatus(baseUrl.trim() || DEFAULT_BASE_URL);
      setOllamaAvailable(status.ollama.available);
      setOpenaiConfigured(status.openai.configured);
      setMaskedOpenaiKey(status.openai.maskedKey || "");
      showStatus("Provider status refreshed");
    } catch (err) {
      setError((err as Error).message || "Failed to refresh provider status.");
    } finally {
      setCheckingProviderStatus(false);
    }
  }

  async function handleSaveOpenaiKey() {
    const trimmedKey = openaiKeyInput.trim();
    if (!trimmedKey) {
      setError("Enter an OpenAI API key before saving.");
      return;
    }
    setSavingOpenaiKey(true);
    setError("");
    try {
      const saved = await saveOpenAIKey(trimmedKey);
      setOpenaiConfigured(true);
      setMaskedOpenaiKey(saved.maskedKey);
      setOpenaiKeyInput("");
      showStatus("OpenAI API key saved locally");
    } catch (err) {
      setError((err as Error).message || "Failed to save OpenAI API key.");
    } finally {
      setSavingOpenaiKey(false);
    }
  }

  async function parseFilesToText(files: File[]): Promise<{ text: string; names: string[] }> {
    const chunks: string[] = [];
    const names: string[] = [];
    for (const file of files) {
      const text = await extractTextFromFile(file);
      if (text.trim()) {
        chunks.push(`[${file.name}]\n${text.trim()}`);
        names.push(file.name);
      }
    }
    return { text: chunks.join("\n\n"), names };
  }

  async function handleIntakeResumeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const extractedText = await extractTextFromFile(file);
      if (!extractedText.trim()) {
        throw new Error("Uploaded resume did not contain readable text.");
      }
      setResumeText(extractedText);
      setResumeFileName(file.name);
      showStatus(`Loaded resume from ${file.name}`);
    } catch (err) {
      setError((err as Error).message || "Failed to parse resume file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleIntakeSourceMaterialsUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setError("");
    try {
      const parsed = await parseFilesToText(files);
      if (!parsed.text.trim()) {
        throw new Error("Uploaded files did not contain readable text.");
      }
      setSourceDocumentsText(parsed.text);
      setSourceDocumentNames(parsed.names);
      setAutoMemoryPrefilled(false);
      showStatus(`Loaded ${parsed.names.length} source file(s)`);
    } catch (err) {
      setError((err as Error).message || "Failed to parse source materials.");
    } finally {
      event.target.value = "";
    }
  }

  async function runAutoMemoryPrefill(materialText: string, source: "intake" | "step3-entry") {
    if (!materialText.trim()) return;
    if (!ensureSelectedProviderReady()) return;
    setAutoPrefillingMemory(true);
    if (source === "intake") {
      showStatus("Preparing memory suggestions from uploaded materials...");
    }
    try {
      const firstRaw = await chatWithProvider(
        providerConfig,
        [
          { role: "system", content: MEMORY_SYSTEM_PROMPT },
          { role: "user", content: buildMemoryUserPrompt(materialText.trim()) }
        ]
      );

      let parsed = parseAndValidateMemory(firstRaw);
      if (!parsed.ok) {
        const fixedRaw = await chatWithProvider(
          providerConfig,
          [
            { role: "system", content: MEMORY_SYSTEM_PROMPT },
            { role: "user", content: buildFixMemoryJsonPrompt(firstRaw) }
          ]
        );
        parsed = parseAndValidateMemory(fixedRaw);
        if (parsed.ok) {
          setRawMemoryOutput(fixedRaw);
        } else {
          setRawMemoryOutput(`${firstRaw}\n\n--- RETRY OUTPUT ---\n\n${fixedRaw}`);
          setError(`Auto memory prefill failed: ${parsed.error}`);
          setAutoMemoryPrefilled(true);
          return;
        }
      } else {
        setRawMemoryOutput(firstRaw);
      }

      setMemoryDraft(parsed.data);
      setAutoMemoryPrefilled(true);
      showStatus("Step 3 memory suggestions are ready.");
    } catch (err) {
      setError((err as Error).message || "Auto memory prefill failed.");
      setAutoMemoryPrefilled(true);
    } finally {
      setAutoPrefillingMemory(false);
    }
  }

  async function completeIntake() {
    if (!resumeText.trim()) {
      setError("Upload your initial resume before continuing.");
      return;
    }
    if (!ensureSelectedProviderReady()) return;
    setError("");
    setIntakeCompleted(true);
    setAppMode("pipeline");
    setCurrentStep(1);
    if (sourceDocumentsText.trim()) {
      await runAutoMemoryPrefill(sourceDocumentsText, "intake");
    }
    showStatus("Intake complete. You can start Step 1 now.");
  }

  function updateMemoryItem(category: keyof StructuredMemory, index: number, value: string) {
    setMemoryDraft((prev) => {
      const next = cloneMemory(prev);
      next[category][index] = value;
      return next;
    });
  }

  function addMemoryItem(category: keyof StructuredMemory) {
    setMemoryDraft((prev) => {
      const next = cloneMemory(prev);
      next[category].push("");
      return next;
    });
  }

  function deleteMemoryItem(category: keyof StructuredMemory, index: number) {
    setMemoryDraft((prev) => {
      const next = cloneMemory(prev);
      next[category].splice(index, 1);
      return next;
    });
  }

  async function generateDraft(revisionFeedback: string): Promise<boolean> {
    if (!intakeCompleted || !resumeText.trim()) {
      setError("Complete Intake first with an initial resume.");
      return false;
    }
    if (!roleTemplate || !tone || !length) {
      setError("Complete Step 1 writing setup before generating.");
      return false;
    }
    if (!jdIsValid) {
      setError(`Job description must be at least ${MIN_JD_LENGTH} characters.`);
      return false;
    }
    if (!ensureSelectedProviderReady()) return false;

    setError("");
    setRawOutput("");
    setLoadingDraft(true);
    setCopied(false);

    const userPrompt = buildUserPrompt({
      roleTemplate,
      tone,
      length,
      jdText: jdText.trim(),
      resumeText: resumeText.trim(),
      profileText: profileText.trim(),
      structuredMemoryText: serializeMemoryForPrompt(memoryDraft),
      companyName: companyName.trim(),
      jobTitle: jobTitle.trim(),
      extraInstructions: extraInstructions.trim(),
      revisionFeedback: revisionFeedback.trim(),
      previousDraft: revisionFeedback.trim() ? draftText.trim() : "",
      generationDate: todayDateString(),
      applicantName: applicantName.trim(),
      applicantContactLine: applicantContactLine.trim(),
      applicantLocationLine: applicantLocationLine.trim(),
      signatureName: signatureName.trim()
    });

    try {
      const firstRaw = await chatWithProvider(
        providerConfig,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ]
      );

      let parsed = tryParseAndValidate(firstRaw);
      if (!parsed.ok) {
        const fixedRaw = await chatWithProvider(
          providerConfig,
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildFixJsonPrompt(firstRaw) }
          ]
        );
        parsed = tryParseAndValidate(fixedRaw);
        if (parsed.ok) {
          setRawOutput(fixedRaw);
        } else {
          setRawOutput(`${firstRaw}\n\n--- RETRY OUTPUT ---\n\n${fixedRaw}`);
          setError(`Failed to parse cover-letter JSON after retry: ${parsed.error}`);
          return false;
        }
      } else {
        setRawOutput(firstRaw);
      }

      setCoverLetterResult(parsed.data);
      setDraftText(parsed.data.cover_letter);
      setLastDraftKey(draftKey);
      setInterviewTips(null);
      setLastTipsKey("");
      setExportStatus("");
      return true;
    } catch (err) {
      setError((err as Error).message || "Draft generation failed.");
      return false;
    } finally {
      setLoadingDraft(false);
    }
  }

  async function generateInterviewTips() {
    if (!draftText.trim()) return;
    if (!ensureSelectedProviderReady()) return;
    setLoadingInterviewTips(true);
    setError("");
    setRawInterviewOutput("");
    try {
      const firstRaw = await chatWithProvider(
        providerConfig,
        [
          { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildInterviewTipsUserPrompt({
              jdText: jdText.trim(),
              resumeText: resumeText.trim(),
              companyName: companyName.trim(),
              jobTitle: jobTitle.trim(),
              draftText: draftText.trim()
            })
          }
        ]
      );

      let parsed = parseAndValidateInterviewTips(firstRaw);
      if (!parsed.ok) {
        const fixedRaw = await chatWithProvider(
          providerConfig,
          [
            { role: "system", content: INTERVIEW_SYSTEM_PROMPT },
            { role: "user", content: buildFixInterviewJsonPrompt(firstRaw) }
          ]
        );
        parsed = parseAndValidateInterviewTips(fixedRaw);
        if (parsed.ok) {
          setRawInterviewOutput(fixedRaw);
        } else {
          setRawInterviewOutput(`${firstRaw}\n\n--- RETRY OUTPUT ---\n\n${fixedRaw}`);
          setError(`Failed to parse interview tips JSON after retry: ${parsed.error}`);
          return;
        }
      } else {
        setRawInterviewOutput(firstRaw);
      }
      setInterviewTips(parsed.data);
      setLastTipsKey(tipsKey);
    } catch (err) {
      setError((err as Error).message || "Interview tips generation failed.");
    } finally {
      setLoadingInterviewTips(false);
    }
  }

  async function handleSavePdf() {
    setExportStatus("");
    setError("");
    if (!draftText.trim()) {
      setError("Generate a draft first, then save PDF.");
      return;
    }
    if (!outputFolder.trim()) {
      setError("Output folder is required for PDF export.");
      return;
    }
    if (!templateDocxPath.trim()) {
      setError("Template .docx path is required for PDF export.");
      return;
    }

    setExportingPdf(true);
    try {
      const resolvedCompany = companyName.trim() || inferCompanyFromDraft(draftText) || inferCompanyFromJd(jdText) || "Company";
      const today = todayDateString();
      const templateFields = buildTemplateFieldsFromDraft({
        draftText,
        companyName: resolvedCompany,
        dateLine: today,
        applicantName: applicantName.trim(),
        applicantContactLine: applicantContactLine.trim(),
        applicantLocationLine: applicantLocationLine.trim(),
        signatureName: signatureName.trim()
      });

      const saved = await saveCoverLetterWithHelper({
        fields: templateFields,
        coverLetter: draftText,
        companyName: resolvedCompany,
        jobTitle: jobTitle.trim(),
        outputFolder: outputFolder.trim(),
        date: today,
        templateDocxPath: templateDocxPath.trim()
      });
      setExportStatus(`Saved PDF: ${saved.pdfPath}`);
      showStatus("PDF exported");
    } catch (err) {
      setError((err as Error).message || "PDF export failed.");
    } finally {
      setExportingPdf(false);
    }
  }

  function handleSaveLocally() {
    showStatus("Saved locally");
  }

  function handleClearSavedData() {
    clearSavedState();
    setAppMode("intake");
    setCurrentStep(1);
    setIntakeCompleted(false);
    setRoleTemplate("");
    setTone("");
    setLength("");
    setJdText("");
    setExtraInstructions("");
    setProfileText("");
    setGenerationFeedback("");
    setResumeText("");
    setResumeFileName("");
    setSourceDocumentsText("");
    setSourceDocumentNames([]);
    setCompanyName("");
    setJobTitle("");
    setOutputFolder("");
    setTemplateDocxPath(DEFAULT_TEMPLATE_DOCX_PATH);
    setApplicantName("");
    setApplicantContactLine("");
    setApplicantLocationLine("");
    setSignatureName("");
    setSelectedProvider(DEFAULT_PROVIDER);
    setProviderModelMap(defaultProviderModelMap());
    setOpenaiKeyInput("");
    setMemoryDraft(cloneMemory(EMPTY_MEMORY));
    setAutoMemoryPrefilled(false);
    setCoverLetterResult(null);
    setDraftText("");
    setInterviewTips(null);
    setLastDraftKey("");
    setLastTipsKey("");
    setRawOutput("");
    setRawMemoryOutput("");
    setRawInterviewOutput("");
    setIsGeneratingFromStep3(false);
    showStatus("Cleared successfully");
  }

  function resetCurrentWorkflowForNextJob() {
    setCurrentStep(1);
    setStepTransitionPhase("idle");
    setPendingStep(null);
    setRoleTemplate("");
    setTone("");
    setLength("");
    setJdText("");
    setExtraInstructions("");
    setProfileText("");
    setGenerationFeedback("");
    setCompanyName("");
    setJobTitle("");
    setMemoryDraft(cloneMemory(EMPTY_MEMORY));
    setAutoMemoryPrefilled(false);
    setCoverLetterResult(null);
    setDraftText("");
    setInterviewTips(null);
    setLastDraftKey("");
    setLastTipsKey("");
    setRawOutput("");
    setRawMemoryOutput("");
    setRawInterviewOutput("");
    setError("");
    setExportStatus("");
    setShowValidationDialog(false);
    setShowStep3Validation(false);
    setIsGeneratingFromStep3(false);
  }

  function handleCompleteAndNextJob() {
    resetCurrentWorkflowForNextJob();
    showStatus("Ready for the next job.");
  }

  async function handleCopyDraft() {
    if (!draftText.trim()) return;
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("Could not copy draft. Copy manually.");
    }
  }

  function handleDownloadTxt() {
    if (!draftText.trim()) return;
    downloadTextFile("cover-letter-draft.txt", draftText);
  }

  async function handleGenerateFromAction() {
    if (loadingDraft || exportingPdf) return;
    if (!canGenerateDraft) {
      setShowStep3Validation(true);
      setShowValidationDialog(true);
      setError("Please complete all required items before generating.");
      return;
    }
    setError("");
    setShowStep3Validation(false);
    setIsGeneratingFromStep3(true);
    goToStep(4);
    await generateDraft("");
    setIsGeneratingFromStep3(false);
  }

  const coverLetterWordCount = useMemo(() => countWords(draftText), [draftText]);
  const hasMemory = useMemo(() => !memoryIsEmpty(memoryDraft), [memoryDraft]);

  function renderIntake() {
    const resumeReady = !!resumeText.trim();
    return (
      <section className="panel wizardPanel intakePanel">
        <h2>User Intake</h2>
        <p className="muted">
          Complete this once: bind your API and upload your initial resume. Optional source files help auto-build Step 3 memory.
        </p>

        <h3>Step A: API Binding</h3>
        <div className="grid two">
          <label>
            Provider
            <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value as ModelProvider)}>
              <option value="ollama">Local Ollama</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            Model
            <select value={selectedModel} onChange={(e) => updateSelectedModel(e.target.value)}>
              {MODEL_OPTIONS[selectedProvider].map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="providerStatusRow">
          <span className={ollamaAvailable ? "statusPill ok" : "statusPill warn"}>
            Ollama {ollamaAvailable ? "available" : ollamaAvailable === false ? "unavailable" : "unchecked"}
          </span>
          <span className={openaiConfigured ? "statusPill ok" : "statusPill warn"}>
            OpenAI {openaiConfigured ? `configured (${maskedOpenaiKey})` : "not configured"}
          </span>
          <button type="button" onClick={() => void refreshProviderStatus()} disabled={checkingProviderStatus}>
            {checkingProviderStatus ? "Checking..." : "Refresh Status"}
          </button>
        </div>

        {selectedProvider === "openai" && !openaiConfigured && (
          <div className="inlineGuidanceBlock">
            <p className="warningText">OpenAI selected. Save API key to finish binding.</p>
            <div className="grid two">
              <label>
                OpenAI API Key
                <input
                  type="password"
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </label>
            </div>
            <button type="button" onClick={() => void handleSaveOpenaiKey()} disabled={savingOpenaiKey}>
              {savingOpenaiKey ? "Saving Key..." : "Save OpenAI Key"}
            </button>
          </div>
        )}

        <h3>Step B: Initial Files</h3>
        <div className="row wrap">
          <label className="fileUploadLabel">
            Upload Initial Resume (.txt/.pdf/.docx)
            <input
              type="file"
              accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleIntakeResumeUpload}
            />
          </label>
        </div>
        {resumeReady ? (
          <p className="statusText">Resume ready: {resumeFileName || "Uploaded and parsed"}</p>
        ) : (
          <p className="warningText">Initial resume is required.</p>
        )}

        <div className="row wrap">
          <label className="fileUploadLabel">
            Upload Source Materials (Optional: transcript, papers, portfolio)
            <input
              type="file"
              multiple
              accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleIntakeSourceMaterialsUpload}
            />
          </label>
        </div>
        {sourceDocumentNames.length > 0 && (
          <p className="muted">Source files: {sourceDocumentNames.join(", ")}</p>
        )}

        <div className="nextStepRow">
          <button type="button" onClick={() => void completeIntake()} disabled={!resumeReady || !selectedProviderReady}>
            Complete Intake & Start Pipeline
          </button>
        </div>
      </section>
    );
  }

  function renderStep1() {
    return (
      <section className="panel wizardPanel">
        <h2>Step 1: Writing Setup</h2>
        <p className="muted">Set writing strategy for this job. API/model settings are in the left drawer Settings.</p>

        <div className="grid three">
          <label>
            Role Direction
            <select value={roleTemplate} onChange={(e) => setRoleTemplate(e.target.value as RoleTemplateOption)}>
              <option value="">Select role direction</option>
              <option>Consulting</option>
              <option>Accounting</option>
              <option>Data</option>
              <option>General</option>
            </select>
          </label>
          <label>
            Tone
            <select value={tone} onChange={(e) => setTone(e.target.value as ToneOption)}>
              <option value="">Select tone</option>
              <option>Professional</option>
              <option>Natural</option>
              <option>Confident</option>
              <option>Concise</option>
            </select>
          </label>
          <label>
            Target Length
            <select value={length} onChange={(e) => setLength(e.target.value as LengthOption)}>
              <option value="">Select length</option>
              <option value="200">200 words</option>
              <option value="300">300 words</option>
              <option value="400">400 words</option>
            </select>
          </label>
        </div>

        <label>
          Cover Letter Template (.docx path)
          <input
            value={templateDocxPath}
            onChange={(e) => setTemplateDocxPath(e.target.value)}
            placeholder="Example: C:\\Templates\\cover-letter-template.docx"
          />
        </label>

        <div className="grid two">
          <label>
            Applicant Name
            <input
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              placeholder="Example: Jane Doe"
            />
          </label>
          <label>
            Signature Name (optional)
            <input
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="Defaults to Applicant Name"
            />
          </label>
        </div>

        <div className="grid two">
          <label>
            Contact Line
            <input
              value={applicantContactLine}
              onChange={(e) => setApplicantContactLine(e.target.value)}
              placeholder="Example: +1 555-555-5555 | jane@example.com"
            />
          </label>
          <label>
            Location Line (optional)
            <input
              value={applicantLocationLine}
              onChange={(e) => setApplicantLocationLine(e.target.value)}
              placeholder="Example: Austin, TX"
            />
          </label>
        </div>

        <div className="grid two">
          <label>
            Company Name (optional)
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Leave blank to infer from JD"
            />
          </label>
          <label>
            Job Title (optional)
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Leave blank to infer from JD"
            />
          </label>
        </div>

        <label>
          Output Folder
          <input
            value={outputFolder}
            onChange={(e) => setOutputFolder(e.target.value)}
            placeholder="Example: D:\\CoverLetters\\Output"
          />
        </label>

        <div className="row wrap">
          <button type="button" onClick={handleSaveLocally}>Save Locally</button>
          <button type="button" onClick={handleClearSavedData}>Clear Saved Data</button>
          <button type="button" className="nextStepButton" onClick={() => goToStep(2)} disabled={!setupComplete}>
            Next Step
          </button>
        </div>
      </section>
    );
  }

  function renderStep2() {
    return (
      <section className="panel wizardPanel">
        <h2>Step 2: Job Description</h2>
        <p className="muted">Paste the full JD. Include responsibilities and requirements for better targeting.</p>
        <label>
          Job Description
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={14}
            placeholder="Paste job description here..."
          />
        </label>
        <p className="muted">Current length: {jdText.trim().length} characters (minimum {MIN_JD_LENGTH}).</p>
        <div className="nextStepRow">
          <button type="button" onClick={() => goToStep(3)} disabled={!jdIsValid}>Next Step</button>
        </div>
      </section>
    );
  }

  function renderStep3() {
    const setupMissing = showStep3Validation && !setupComplete;
    const jdMissing = showStep3Validation && !jdIsValid;
    const intakeMissing = showStep3Validation && (!intakeCompleted || !resumeText.trim());
    const providerMissing = showStep3Validation && selectedProvider === "openai" && !openaiConfigured;
    return (
      <section className="panel wizardPanel">
        <h2>Step 3: Extra Input (DIY)</h2>
        <p className="muted">Use this step for your own angle: ideas, highlights, and success stories for this role.</p>

        {showStep3Validation && generationBlockingItems.length > 0 && (
          <div className="validationBanner" role="alert">
            <h3>Please complete required items first</h3>
            <ul>
              {generationBlockingItems.map((item) => (
                <li key={item.message}>{item.message}</li>
              ))}
            </ul>
          </div>
        )}

        {(setupMissing || jdMissing || intakeMissing || providerMissing) && (
          <div className="inlineGuidanceBlock">
            {intakeMissing && <p className="warningText">Intake data is missing. Complete Intake first.</p>}
            {providerMissing && <p className="warningText">OpenAI key missing. Bind API key in Intake.</p>}
            {setupMissing && <p className="warningText">Step 1 setup is incomplete.</p>}
            {jdMissing && <p className="warningText">Step 2 job description is too short.</p>}
          </div>
        )}

        {autoPrefillingMemory && <p className="statusText">Auto-prefilling memory from your uploaded source files...</p>}
        {sourceDocumentNames.length > 0 && (
          <p className="muted">Source files linked from Intake: {sourceDocumentNames.join(", ")}</p>
        )}
        <p className="muted">Memory suggestions available: {hasMemory ? "Yes" : "No (you can add manually)"}</p>

        <label>
          Personalized Instructions (optional)
          <textarea
            value={extraInstructions}
            onChange={(e) => setExtraInstructions(e.target.value)}
            rows={6}
            placeholder="Example: emphasize stakeholder communication, avoid generic opening, keep concise"
          />
        </label>

        <label>
          Additional Context Notes (optional)
          <textarea
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
            rows={5}
            placeholder="Anything else the assistant should know for this specific application"
          />
        </label>

        {MEMORY_CATEGORIES.map((category) => (
          <div key={category} className="memoryCategory">
            <div className="memoryHeader">
              <h3>{MEMORY_LABELS[category]}</h3>
              <button type="button" onClick={() => addMemoryItem(category)}>Add item</button>
            </div>
            {memoryDraft[category].length === 0 ? (
              <p className="muted">No items yet.</p>
            ) : (
              <div className="memoryList">
                {memoryDraft[category].map((item, index) => (
                  <div key={`${category}-${index}`} className="memoryItemRow">
                    <input value={item} onChange={(e) => updateMemoryItem(category, index, e.target.value)} />
                    <button type="button" onClick={() => deleteMemoryItem(category, index)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="nextStepRow">
          <button type="button" onClick={() => void handleGenerateFromAction()} disabled={loadingDraft || exportingPdf}>
            {loadingDraft ? "Generating..." : "Generate & Next Step"}
          </button>
        </div>
      </section>
    );
  }

  function renderStep4() {
    const isWaitingDraft = (loadingDraft || isGeneratingFromStep3) && !draftText.trim();
    const suggestion = coverLetterResult?.ai_suggestion;
    const suggestionClass = suggestion ? `suggestionCard ${suggestion.status}` : "suggestionCard";

    return (
      <section className="panel wizardPanel">
        <h2>Step 4: Draft Review</h2>
        <p className="muted">Current pipeline model: {selectedProvider} / {selectedModel}</p>

        <div className="row wrap">
          <button type="button" onClick={handleCopyDraft} disabled={!draftText.trim()}>
            {copied ? "Copied" : "Copy Draft"}
          </button>
          <button type="button" onClick={handleDownloadTxt} disabled={!draftText.trim()}>
            Download .txt
          </button>
        </div>

        {isWaitingDraft ? (
          <div className="generationLoadingCard" role="status" aria-live="polite">
            <div className="generationLoadingHeader">
              <span className="generationSpinner" />
              <p>AI is preparing your draft...</p>
            </div>
            <div className="loadingShimmerLine" />
            <div className="loadingShimmerLine w90" />
            <div className="loadingShimmerLine w80" />
            <div className="loadingShimmerBlock" />
          </div>
        ) : (
          <>
            <p className="muted">Word count: {coverLetterWordCount}</p>
            <label>
              Editable Draft Preview
              <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={16} />
            </label>
          </>
        )}

        <label>
          Feedback for Regeneration
          <textarea
            value={generationFeedback}
            onChange={(e) => setGenerationFeedback(e.target.value)}
            rows={4}
            placeholder="Example: more concise, less generic, stronger problem-solving evidence"
          />
        </label>

        <div className="row wrap">
          <button
            type="button"
            onClick={() => void generateDraft(generationFeedback)}
            disabled={loadingDraft || !generationFeedback.trim() || !selectedProviderReady}
          >
            Regenerate with Feedback
          </button>
          <button type="button" onClick={handleSavePdf} disabled={exportingPdf || !draftText.trim()}>
            {exportingPdf ? "Saving PDF..." : "Export to PDF"}
          </button>
          <button type="button" onClick={() => goToStep(5)} disabled={!draftText.trim()}>
            Next Step
          </button>
        </div>

        {exportStatus && <p className="statusText">{exportStatus}</p>}

        {coverLetterResult && !isWaitingDraft && (
          <div className="step4Insights">
            <section className="panel insightCard">
              <h3>Evidence Map</h3>
              <div className="evidenceList">
                {coverLetterResult.evidence_map.map((item, idx) => {
                  const missingEvidence = item.resume_evidence.length === 0;
                  return (
                    <div key={`${idx}-${item.cover_letter_sentence}`} className={`evidenceItem ${missingEvidence ? "missingEvidence" : ""}`}>
                      <p><strong>Sentence:</strong> {item.cover_letter_sentence}</p>
                      {missingEvidence ? (
                        <p className="warningText">No supporting evidence found. Please verify this claim manually.</p>
                      ) : (
                        <ul>
                          {item.resume_evidence.map((ev, evIdx) => (
                            <li key={`${idx}-${evIdx}`}>{ev}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={`panel insightCard ${suggestionClass}`}>
              <h3>AI Suggestions</h3>
              {suggestion ? (
                <>
                  <p className="suggestionBadge">
                    {suggestion.status.toUpperCase()} | Score {suggestion.score}/10
                  </p>
                  <p>{suggestion.summary}</p>
                  <h4>Risk / Fit Reasons</h4>
                  <ul>
                    {suggestion.reasons.map((reason, idx) => (
                      <li key={`reason-${idx}`}>{reason}</li>
                    ))}
                  </ul>
                  <h4>Suggested Actions</h4>
                  <ul>
                    {suggestion.actions.map((action, idx) => (
                      <li key={`action-${idx}`}>{action}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted">Suggestions are not available yet.</p>
              )}
            </section>
          </div>
        )}
      </section>
    );
  }

  function renderTipsList(title: string, items: string[]) {
    return (
      <div className="tipsBlock">
        <h3>{title}</h3>
        {items.length === 0 ? (
          <p className="muted">No items generated.</p>
        ) : (
          <ul>
            {items.map((item, idx) => (
              <li key={`${title}-${idx}`}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function renderStep5() {
    return (
      <section className="panel wizardPanel">
        <h2>Step 5: Interview Tips</h2>
        <p className="muted">Generate tips only when needed.</p>
        <div className="row wrap">
          <button type="button" onClick={() => void generateInterviewTips()} disabled={loadingInterviewTips || !selectedProviderReady}>
            {loadingInterviewTips ? "Generating Tips..." : "Regenerate Tips"}
          </button>
        </div>
        {interviewTips && (
          <div className="tipsGrid">
            {renderTipsList("Likely Interview Focus Areas", interviewTips.focus_areas)}
            {renderTipsList("JD Priorities", interviewTips.jd_priorities)}
            {renderTipsList("Experiences To Emphasize", interviewTips.experience_to_emphasize)}
            {renderTipsList("Top Interview Tips (2-5)", interviewTips.interview_tips)}
          </div>
        )}
        <div className="nextWorkflowCtaWrap">
          <button type="button" className="nextWorkflowCta" onClick={handleCompleteAndNextJob}>
            Complete & go for next JOB
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="headerTop">
          {appMode === "pipeline" && (
            <button
              type="button"
              className="menuToggle"
              onClick={() => setIsSideRailOpen(true)}
              aria-label="Open step navigation"
              title="Open steps"
            >
              <span />
              <span />
              <span />
            </button>
          )}
          <h1>Cover Letter Agent (MVP-1 Wizard)</h1>
        </div>
        <p>{appMode === "intake" ? "User intake setup before pipeline." : "Guided 5-step workflow for cover letter generation."}</p>
      </header>

      <div className="layoutShell">
        <div className="mainStage">
          {statusMessage && (
            <section className="panel">
              <p className="statusText">{statusMessage}</p>
            </section>
          )}

          {error && (
            <section className="panel error">
              <h2>Error</h2>
              <p>{error}</p>
            </section>
          )}

          {appMode === "intake" ? (
            renderIntake()
          ) : (
            <div
              className={`stepTransition ${
                stepTransitionPhase === "out" ? "stepLeaving" : stepTransitionPhase === "in" ? "stepEntering" : ""
              }`}
            >
              {currentStep === 1 && renderStep1()}
              {currentStep === 2 && renderStep2()}
              {currentStep === 3 && renderStep3()}
              {currentStep === 4 && renderStep4()}
              {currentStep === 5 && renderStep5()}
            </div>
          )}
        </div>
      </div>

      {appMode === "pipeline" && (
        <>
          <button
            type="button"
            className={`navOverlay ${isSideRailOpen ? "open" : ""}`}
            aria-label="Close step navigation"
            onClick={() => setIsSideRailOpen(false)}
          />

          <aside className={`leftDrawer ${isSideRailOpen ? "open" : ""}`} aria-hidden={!isSideRailOpen}>
            <div className="leftDrawerBody">
              <div>
                <div className="leftDrawerHeader">
                  <h2>Steps</h2>
                  <button
                    type="button"
                    className="leftDrawerClose"
                    onClick={() => setIsSideRailOpen(false)}
                    aria-label="Close step navigation"
                  >
                    x
                  </button>
                </div>
                <WizardStepper
                  steps={STEPS as unknown as Array<{ id: number; title: string }>}
                  currentStep={currentStep}
                  onSelectStep={goToStep}
                  canAccessStep={canAccessStep}
                />
              </div>

              <div className="drawerSettings">
                <h3>Settings</h3>
                <label>
                  Provider
                  <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value as ModelProvider)}>
                    <option value="ollama">Local Ollama</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </label>
                <label>
                  Model
                  <select value={selectedModel} onChange={(e) => updateSelectedModel(e.target.value)}>
                    {MODEL_OPTIONS[selectedProvider].map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
                {selectedProvider === "openai" && !openaiConfigured && (
                  <p className="warningText">OpenAI key is not configured. Switch to Intake to bind key.</p>
                )}
                <button type="button" onClick={() => setAppMode("intake")}>Back to Intake</button>
              </div>
            </div>
          </aside>
        </>
      )}

      {showValidationDialog && generationBlockingItems.length > 0 && (
        <div className="validationModalBackdrop" onClick={() => setShowValidationDialog(false)}>
          <div
            className="validationModal"
            role="dialog"
            aria-modal="true"
            aria-label="Missing required items"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Cannot Generate Yet</h2>
            <p>Please complete these required items:</p>
            <ul>
              {generationBlockingItems.map((item) => (
                <li key={item.message}>{item.message}</li>
              ))}
            </ul>
            <div className="row wrap">
              <button
                type="button"
                onClick={() => {
                  const firstStep = generationBlockingItems[0]?.step ?? 1;
                  setShowValidationDialog(false);
                  if (firstStep === 0) {
                    setAppMode("intake");
                    return;
                  }
                  goToStep(firstStep);
                }}
              >
                Go fix first item
              </button>
              <button type="button" onClick={() => setShowValidationDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <section className="panel">
        <h2>Debug Output (Draft)</h2>
        <textarea readOnly value={rawOutput} rows={6} placeholder="Draft model output..." />
      </section>

      <section className="panel">
        <h2>Debug Output (Memory)</h2>
        <textarea readOnly value={rawMemoryOutput} rows={6} placeholder="Memory model output..." />
      </section>

      <section className="panel">
        <h2>Debug Output (Interview Tips)</h2>
        <textarea readOnly value={rawInterviewOutput} rows={6} placeholder="Interview tips model output..." />
      </section>

      <section className="panel">
        <p className="muted">Last draft fingerprint: {lastDraftKey ? "generated" : "none"} | Last tips fingerprint: {lastTipsKey ? "generated" : "none"}</p>
      </section>
    </div>
  );
}

export default App;
