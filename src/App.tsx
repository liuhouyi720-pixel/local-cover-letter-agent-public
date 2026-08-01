import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { WizardStepper } from "./components/WizardStepper";
import { KnowledgeBase } from "./components/KnowledgeBase";
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
import { loadLatestImportedJob } from "./lib/jobImport";
import {
  approveMemoryCandidate, createApplicationSession, createMemoryCandidates, getApplicationSession, listKnowledge, listMemoryCandidates,
  recordKnowledgeUsage, rejectMemoryCandidate, retrieveKnowledge, updateApplicationSession
} from "./lib/knowledgeApi";
import { buildCandidateExtractionPrompt, buildContentPlanPrompt, buildDuplicatePrompt, buildJobRequirementsPrompt, buildRerankPrompt } from "./lib/knowledgePrompts";
import { parseCandidateProposals, parseContentPlan, parseDuplicateDecision, parseRankedKnowledge, parseRequirements } from "./lib/knowledgeValidation";
import { CandidateProposal, ContentPlan, JobRequirement, KnowledgeItem, MemoryCandidate } from "./lib/knowledgeTypes";
import "./App.css";

const DEFAULT_PROVIDER: ModelProvider = "ollama";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TEMPLATE_DOCX_PATH = "";
const MIN_JD_LENGTH = 120;
const STEP_TRANSITION_MS = 180;
const JOB_IMPORT_POLL_INTERVAL_MS = 2000;

const MODEL_OPTIONS: Record<ModelProvider, string[]> = {
  ollama: ["qwen2.5:7b-instruct", "llama3.1:8b-instruct", "mistral:7b-instruct"],
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]
};

type AppMode = "intake" | "pipeline" | "knowledge";

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
  const [applicationSessionId, setApplicationSessionId] = useState("");
  const [jobRequirements, setJobRequirements] = useState<JobRequirement[]>([]);
  const [recommendedKnowledge, setRecommendedKnowledge] = useState<Array<{ item: KnowledgeItem; score: number; matched_requirements: string[] }>>([]);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<string[]>([]);
  const [uncoveredRequirementIds, setUncoveredRequirementIds] = useState<string[]>([]);
  const [supplementText, setSupplementText] = useState("");
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [candidateChoices, setCandidateChoices] = useState<Record<string, { useNow: boolean; saveFuture: boolean }>>({});
  const [contentPlan, setContentPlan] = useState<ContentPlan | null>(null);
  const [analyzingKnowledge, setAnalyzingKnowledge] = useState(false);
  const [extractingCandidates, setExtractingCandidates] = useState(false);

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
  const [lastImportedJobAt, setLastImportedJobAt] = useState("");
  const [importSyncState, setImportSyncState] = useState<"idle" | "ok" | "helper-down" | "invalid-job">("idle");

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
    if (!roleTemplate) items.push({ step: 1, message: "Step 1: Select Role Direction." });
    if (!tone) items.push({ step: 1, message: "Step 1: Select Tone." });
    if (!length) items.push({ step: 1, message: "Step 1: Select Target Length." });
    if (!jdIsValid) items.push({ step: 2, message: `Step 2: Job Description needs at least ${MIN_JD_LENGTH} characters.` });
    if (selectedProvider === "openai" && !openaiConfigured) {
      items.push({ step: 0, message: "OpenAI selected but API key is not configured in Intake." });
    }
    return items;
  }, [intakeCompleted, roleTemplate, tone, length, jdIsValid, selectedProvider, openaiConfigured]);

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
    if (typeof saved.applicationSessionId === "string" && saved.applicationSessionId) {
      setApplicationSessionId(saved.applicationSessionId);
      void Promise.all([getApplicationSession(saved.applicationSessionId), listMemoryCandidates(saved.applicationSessionId)])
        .then(([session, candidates]) => {
          if (session.status !== "active") return;
          setCompanyName(session.company_name); setJobTitle(session.job_title); setJdText(session.job_description);
          setExtraInstructions(session.user_instructions); setJobRequirements(session.parsed_requirements);
          setSelectedKnowledgeIds(session.selected_knowledge); setContentPlan(session.content_plan);
          setDraftText(session.draft || session.final_text); setMemoryCandidates(candidates);
          setCandidateChoices(Object.fromEntries(candidates.map((candidate) => [candidate.id,
            { useNow: candidate.use_in_current, saveFuture: candidate.save_for_future }])));
        }).catch(() => undefined);
    }
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
      approvedMemory: cloneMemory(memoryDraft),
      applicationSessionId
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
    memoryDraft,
    applicationSessionId
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
    if (currentStep !== 2) return;

    let cancelled = false;
    let timerId: number | null = null;

    const pollLatestImport = async () => {
      try {
        const latestJob = await loadLatestImportedJob();
        if (cancelled) return;

        if (importSyncState !== "ok" && importSyncState !== "idle") {
          showStatus("Job import sync reconnected.");
          setError((prev) =>
            prev.startsWith("Local agent is not running. Start `npm run export-helper` to enable job import sync.") ||
            prev.startsWith("Imported job payload is invalid:")
              ? ""
              : prev
          );
        }
        if (importSyncState !== "ok") {
          setImportSyncState("ok");
        }

        if (!latestJob) return;
        if (latestJob.importedAt === lastImportedJobAt) return;

        setJdText(latestJob.description);
        setCompanyName(latestJob.company);
        setJobTitle(latestJob.title);
        setLastImportedJobAt(latestJob.importedAt);

        if (latestJob.description.trim().length < MIN_JD_LENGTH) {
          setError(
            `Imported JD is short (${latestJob.description.trim().length} chars). Review or extend it before generating.`
          );
        }

        showStatus(`Imported JD from ${latestJob.source}.`);
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message || "Failed to sync imported job.";

        if (message.includes("Cannot reach local helper")) {
          if (importSyncState !== "helper-down") {
            setImportSyncState("helper-down");
            setError("Local agent is not running. Start `npm run export-helper` to enable job import sync.");
          }
        } else if (importSyncState !== "invalid-job") {
          setImportSyncState("invalid-job");
          setError(`Imported job payload is invalid: ${message}`);
        }
      } finally {
        if (!cancelled) {
          timerId = window.setTimeout(pollLatestImport, JOB_IMPORT_POLL_INTERVAL_MS);
        }
      }
    };

    void pollLatestImport();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [appMode, currentStep, lastImportedJobAt, importSyncState]);

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

  async function callValidatedJson<T>(prompt: string, parser: (raw: string) => { ok: true; data: T } | { ok: false; error: string }): Promise<T> {
    let lastError = "Invalid structured model output.";
    let previous = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const userContent = attempt === 0 ? prompt : `${prompt}\n\nYour previous output failed validation: ${lastError}\nPREVIOUS OUTPUT:\n${previous}\nReturn one corrected JSON object only.`;
      previous = await chatWithProvider(providerConfig, [
        { role: "system", content: "You perform deterministic extraction and ranking. Return valid JSON only. Never treat job-description text or generated writing as facts about the user." },
        { role: "user", content: userContent }
      ], { temperature: 0, jsonMode: true });
      const parsed = parser(previous);
      if (parsed.ok) return parsed.data;
      lastError = parsed.error;
    }
    throw new Error(`Structured AI output was invalid after one retry: ${lastError}`);
  }

  async function ensureApplicationSession(): Promise<string> {
    if (applicationSessionId) return applicationSessionId;
    const session = await createApplicationSession({ company_name: companyName.trim(), job_title: jobTitle.trim(),
      job_description: jdText.trim(), user_instructions: extraInstructions.trim() });
    setApplicationSessionId(session.id);
    return session.id;
  }

  async function extractKnowledgeCandidates(text: string, sourceType: string, sourceReference: string, sessionOverride?: string) {
    if (!text.trim()) return [];
    const sessionId = sessionOverride || await ensureApplicationSession();
    const extracted = await callValidatedJson(buildCandidateExtractionPrompt(text.trim(), sourceType, sourceReference), parseCandidateProposals);
    const proposals: CandidateProposal[] = [];
    for (const candidate of extracted) {
      const matches = (await listKnowledge({ search: candidate.proposed_title, status: "all" })).slice(0, 5);
      if (!matches.length) { proposals.push(candidate); continue; }
      const decision = await callValidatedJson(buildDuplicatePrompt(JSON.stringify(candidate), JSON.stringify(matches.map((item) => ({
        id: item.id, title: item.title, category: item.category, summary: item.summary, details: item.details, tags: item.tags.map((tag) => tag.name)
      })))), parseDuplicateDecision);
      const allowedIds = new Set(matches.map((item) => item.id));
      proposals.push({ ...candidate, candidate_action: decision.candidate_action,
        possible_match_id: decision.possible_match_id && allowedIds.has(decision.possible_match_id) ? decision.possible_match_id : null });
    }
    const created = await createMemoryCandidates(sessionId, proposals);
    setMemoryCandidates((current) => [...current, ...created]);
    setCandidateChoices((current) => ({ ...current, ...Object.fromEntries(created.map((candidate) => [candidate.id, { useNow: true, saveFuture: false }])) }));
    return created;
  }

  async function analyzeJobAndRetrieve() {
    if (!jdIsValid || !ensureSelectedProviderReady()) return;
    setAnalyzingKnowledge(true); setError("");
    try {
      const sessionId = await ensureApplicationSession();
      const requirements = await callValidatedJson(buildJobRequirementsPrompt(jdText.trim()), parseRequirements);
      setJobRequirements(requirements);
      await updateApplicationSession(sessionId, { company_name: companyName.trim(), job_title: jobTitle.trim(),
        job_description: jdText.trim(), parsed_requirements: requirements, user_instructions: extraInstructions.trim() });
      const retrieved = await retrieveKnowledge(sessionId, requirements);
      let ordered = retrieved.items;
      let uncovered = retrieved.uncovered_requirement_ids;
      if (retrieved.items.length) {
        try {
          const ranking = await callValidatedJson(buildRerankPrompt(requirements, retrieved.items.map((entry) => entry.item)), parseRankedKnowledge);
          const allowed = new Set(retrieved.items.map((entry) => entry.item.id));
          const rankMap = new Map(ranking.ranked_items.filter((entry) => allowed.has(entry.knowledge_item_id)).map((entry) => [entry.knowledge_item_id, entry]));
          ordered = [...retrieved.items].sort((a, b) => (rankMap.get(b.item.id)?.score || b.score) - (rankMap.get(a.item.id)?.score || a.score))
            .map((entry) => ({ ...entry, score: rankMap.get(entry.item.id)?.score || entry.score,
              matched_requirements: rankMap.get(entry.item.id)?.matched_requirement_ids || entry.matched_requirements }));
          uncovered = ranking.uncovered_requirement_ids;
        } catch (err) {
          setError(`${(err as Error).message} Using structured search order instead.`);
        }
      }
      setRecommendedKnowledge(ordered);
      setSelectedKnowledgeIds(ordered.slice(0, 4).map((entry) => entry.item.id));
      setUncoveredRequirementIds(uncovered);
      await Promise.all(ordered.map((entry) => recordKnowledgeUsage(sessionId, { knowledge_item_id: entry.item.id,
        usage_status: "recommended", selection_reason: `Ranked for requirements: ${entry.matched_requirements.join(", ") || "general fit"}` })));
      showStatus(`Found ${ordered.length} relevant verified item(s).`);
      goToStep(3);
    } catch (err) { setError((err as Error).message || "Could not analyze job requirements."); }
    finally { setAnalyzingKnowledge(false); }
  }

  async function handleExtractSupplement() {
    if (!supplementText.trim() || !ensureSelectedProviderReady()) return;
    setExtractingCandidates(true); setError("");
    try {
      const created = await extractKnowledgeCandidates(supplementText, "application_supplement", `Application ${applicationSessionId || "current"}`);
      setSupplementText(""); showStatus(`Created ${created.length} review candidate(s). Nothing was saved permanently.`);
    } catch (err) { setError((err as Error).message || "Candidate extraction failed."); }
    finally { setExtractingCandidates(false); }
  }

  async function reviewLegacyMemoryForMigration() {
    setExtractingCandidates(true); setError("");
    try {
      const created = await extractKnowledgeCandidates(serializeMemoryForPrompt(memoryDraft), "legacy_browser_memory", "Previous localStorage memory");
      showStatus(`Created ${created.length} migration candidate(s). Approve each item you want to keep.`);
    } catch (err) { setError((err as Error).message || "Legacy-memory migration review failed."); }
    finally { setExtractingCandidates(false); }
  }

  function editCandidate(id: string, patch: Partial<MemoryCandidate>) {
    setMemoryCandidates((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function toggleKnowledgeSelection(id: string, checked: boolean) {
    setSelectedKnowledgeIds((ids) => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((itemId) => itemId !== id));
    if (!checked && applicationSessionId) void recordKnowledgeUsage(applicationSessionId, { knowledge_item_id: id,
      usage_status: "removed_by_user", selection_reason: "Removed during evidence review" }).catch(() => undefined);
  }

  async function approveCandidate(candidate: MemoryCandidate) {
    const choices = candidateChoices[candidate.id] || { useNow: false, saveFuture: false };
    try {
      const result = await approveMemoryCandidate(candidate.id, { use_in_current: choices.useNow,
        save_for_future: choices.saveFuture, edited: candidate });
      setMemoryCandidates((items) => items.map((item) => item.id === candidate.id ? result.candidate : item));
      if (result.knowledge_item && choices.useNow) {
        setRecommendedKnowledge((items) => items.some((entry) => entry.item.id === result.knowledge_item!.id) ? items :
          [...items, { item: result.knowledge_item!, score: 100, matched_requirements: [] }]);
        setSelectedKnowledgeIds((ids) => ids.includes(result.knowledge_item!.id) ? ids : [...ids, result.knowledge_item!.id]);
      }
      showStatus(choices.saveFuture ? "Approved and saved to your knowledge base." : "Approved for this application only.");
    } catch (err) { setError((err as Error).message || "Approval failed."); }
  }

  async function rejectCandidate(candidate: MemoryCandidate) {
    try { const rejected = await rejectMemoryCandidate(candidate.id); setMemoryCandidates((items) => items.map((item) => item.id === candidate.id ? rejected : item)); }
    catch (err) { setError((err as Error).message || "Could not reject candidate."); }
  }

  async function buildCurrentContentPlan(): Promise<{ plan: ContentPlan; evidence: Array<{ id: string; title: string; summary: string; details: unknown }> }> {
    const selectedItems = recommendedKnowledge.filter((entry) => selectedKnowledgeIds.includes(entry.item.id)).map((entry) => entry.item);
    const approvedSession = memoryCandidates.filter((candidate) => ["approved", "edited_and_approved"].includes(candidate.status) && candidate.use_in_current)
      .map((candidate) => ({ id: candidate.id, title: candidate.proposed_title, summary: candidate.proposed_summary, details: candidate.proposed_details }));
    const evidence = [...selectedItems.map((item) => ({ id: item.id, title: item.title, summary: item.summary, details: item.details })), ...approvedSession];
    const fallback: ContentPlan = { selections: evidence.map((entry) => ({ source_type: selectedItems.some((item) => item.id === entry.id) ? "knowledge" : "session_candidate",
      source_id: entry.id, matched_requirement_ids: [], reason: "Selected by user" })), paragraphs: [],
      uncovered_requirement_ids: uncoveredRequirementIds, warnings: evidence.length ? [] : ["No approved personal evidence selected."] };
    let plan = fallback;
    if (evidence.length && jobRequirements.length) {
      plan = await callValidatedJson(buildContentPlanPrompt(jobRequirements, evidence), parseContentPlan);
      const allowed = new Set(evidence.map((entry) => entry.id));
      plan.selections = plan.selections.filter((entry) => allowed.has(entry.source_id));
      plan.paragraphs = plan.paragraphs.map((paragraph) => ({ ...paragraph, source_ids: paragraph.source_ids.filter((id) => allowed.has(id)) }));
    }
    setContentPlan(plan);
    const sessionId = await ensureApplicationSession();
    await updateApplicationSession(sessionId, { selected_knowledge: selectedItems.map((item) => item.id), content_plan: plan });
    await Promise.all(selectedItems.map((item) => recordKnowledgeUsage(sessionId, { knowledge_item_id: item.id,
      usage_status: "selected", selection_reason: "Selected in evidence review" })));
    return { plan, evidence };
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
    if (!ensureSelectedProviderReady()) return;
    setError("");
    try {
      const session = await createApplicationSession();
      setApplicationSessionId(session.id);
      setIntakeCompleted(true);
      setAppMode("pipeline");
      setCurrentStep(1);
      const onboardingSources = [
        resumeText.trim() ? { text: resumeText, type: "resume", reference: resumeFileName || "Pasted resume" } : null,
        sourceDocumentsText.trim() ? { text: sourceDocumentsText, type: "onboarding_material", reference: sourceDocumentNames.join(", ") } : null
      ].filter(Boolean) as Array<{ text: string; type: string; reference: string }>;
      for (const source of onboardingSources) await extractKnowledgeCandidates(source.text, source.type, source.reference, session.id);
      showStatus(onboardingSources.length ? "Intake complete. Review imported candidates in Step 3 before saving." : "Intake complete. You can begin with an empty knowledge base.");
    } catch (err) {
      setError((err as Error).message || "Could not start the local profile session.");
    }
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
    if (!intakeCompleted) {
      setError("Complete Intake first.");
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

    let prepared: Awaited<ReturnType<typeof buildCurrentContentPlan>>;
    try { prepared = await buildCurrentContentPlan(); }
    catch (err) { setError((err as Error).message || "Could not create the evidence plan."); setLoadingDraft(false); return false; }
    const approvedEvidenceText = JSON.stringify({ content_plan: prepared.plan, evidence: prepared.evidence }, null, 2);
    const userPrompt = buildUserPrompt({
      roleTemplate,
      tone,
      length,
      jdText: jdText.trim(),
      resumeText: resumeText.trim(),
      profileText: profileText.trim(),
      structuredMemoryText: approvedEvidenceText,
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
      if (applicationSessionId) {
        await updateApplicationSession(applicationSessionId, { draft: parsed.data.cover_letter });
        const usedIds = [...new Set(parsed.data.evidence_map.flatMap((entry) => entry.source_ids))];
        const approvedCandidateIds = new Set(memoryCandidates.filter((candidate) => candidate.use_in_current && ["approved", "edited_and_approved"].includes(candidate.status)).map((candidate) => candidate.id));
        const allowedUsedIds = usedIds.filter((id) => selectedKnowledgeIds.includes(id) || approvedCandidateIds.has(id));
        await Promise.all(allowedUsedIds.map((id) => recordKnowledgeUsage(applicationSessionId,
          { knowledge_item_id: selectedKnowledgeIds.includes(id) ? id : undefined,
            memory_candidate_id: selectedKnowledgeIds.includes(id) ? undefined : id,
            usage_status: "used_in_draft", selection_reason: "Referenced by sentence-to-source mapping" })));
      }
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
    setLastImportedJobAt("");
    setImportSyncState("idle");
    setApplicationSessionId("");
    setJobRequirements([]);
    setRecommendedKnowledge([]);
    setSelectedKnowledgeIds([]);
    setUncoveredRequirementIds([]);
    setSupplementText("");
    setMemoryCandidates([]);
    setCandidateChoices({});
    setContentPlan(null);
    showStatus("Cleared successfully");
  }

  async function resetCurrentWorkflowForNextJob() {
    if (applicationSessionId) await updateApplicationSession(applicationSessionId, { status: "completed", final_text: draftText });
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
    setImportSyncState("idle");
    setJobRequirements([]);
    setRecommendedKnowledge([]);
    setSelectedKnowledgeIds([]);
    setUncoveredRequirementIds([]);
    setSupplementText("");
    setMemoryCandidates([]);
    setCandidateChoices({});
    setContentPlan(null);
    const session = await createApplicationSession();
    setApplicationSessionId(session.id);
  }

  async function handleCompleteAndNextJob() {
    try { await resetCurrentWorkflowForNextJob(); showStatus("A fresh, isolated application session is ready."); }
    catch (err) { setError((err as Error).message || "Could not start a new application session."); }
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
          Bind a model, then optionally import a resume or source material. Imports become review candidates and are never saved automatically.
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
            Import Resume (Optional: .txt/.pdf/.docx)
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
          <p className="muted">You may skip import and begin with an empty knowledge base.</p>
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
          <button type="button" onClick={() => void completeIntake()} disabled={!selectedProviderReady}>
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
          <button type="button" onClick={() => void analyzeJobAndRetrieve()} disabled={!jdIsValid || analyzingKnowledge}>
            {analyzingKnowledge ? "Analyzing & retrieving…" : "Analyze Job & Retrieve Evidence"}
          </button>
        </div>
      </section>
    );
  }

  function renderStep3() {
    const setupMissing = showStep3Validation && !setupComplete;
    const jdMissing = showStep3Validation && !jdIsValid;
    const intakeMissing = showStep3Validation && !intakeCompleted;
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

        <h3>Recommended verified knowledge</h3>
        <p className="muted">Choose the evidence that may be used. Disabled, archived, unverified, and unrelated items are excluded before ranking.</p>
        {recommendedKnowledge.length === 0 ? <p className="muted">No relevant saved items found. You can still use your current resume or add information below.</p> :
          recommendedKnowledge.map((entry) => <label className="evidenceCard" key={entry.item.id}>
            <span className="row"><input type="checkbox" checked={selectedKnowledgeIds.includes(entry.item.id)} onChange={(e) => toggleKnowledgeSelection(entry.item.id, e.target.checked)} />
              <strong>{entry.item.title}</strong></span>
            <span>{entry.item.summary}</span>
            <small className="muted">Supports: {entry.matched_requirements.join(", ") || "general fit"} · score {entry.score}</small>
          </label>)}
        {uncoveredRequirementIds.length > 0 && <p className="warningText">Uncovered requirements: {uncoveredRequirementIds.join(", ")}</p>}
        {hasMemory && <div className="inlineGuidanceBlock"><p className="muted">Older browser memory was found. It is not treated as verified permanent knowledge.</p><button type="button" onClick={() => void reviewLegacyMemoryForMigration()} disabled={extractingCandidates}>Review legacy memory for migration</button></div>}

        <label>
          Writing Instructions (optional; not treated as personal facts)
          <textarea
            value={extraInstructions}
            onChange={(e) => setExtraInstructions(e.target.value)}
            rows={6}
            placeholder="Example: emphasize stakeholder communication, avoid generic opening, keep concise"
          />
        </label>

        <label>
          What should the agent know for this application that is missing from your profile?
          <textarea
            value={supplementText}
            onChange={(e) => setSupplementText(e.target.value)}
            rows={5}
            placeholder="Describe a project, accomplishment, preference, or story. Nothing becomes permanent until you approve it."
          />
        </label>
        <button type="button" onClick={() => void handleExtractSupplement()} disabled={!supplementText.trim() || extractingCandidates}>
          {extractingCandidates ? "Extracting candidates…" : "Extract for Review"}
        </button>

        {memoryCandidates.length > 0 && <div><h3>Candidate review</h3><p className="muted">“Use now” and “Save for future” are independent. Only approval can make either choice effective.</p></div>}
        {memoryCandidates.map((candidate) => <div className="candidateCard" key={candidate.id}>
          <div className="row wrap"><span className="statusPill">{candidate.status}</span><span className="statusPill">{candidate.candidate_action}</span></div>
          <label>Title<input disabled={candidate.status !== "pending"} value={candidate.proposed_title} onChange={(e) => editCandidate(candidate.id, { proposed_title: e.target.value })} /></label>
          <label>Category<select disabled={candidate.status !== "pending"} value={candidate.proposed_category} onChange={(e) => editCandidate(candidate.id, { proposed_category: e.target.value as MemoryCandidate["proposed_category"] })}>{["education", "work_experience", "project", "skill", "achievement", "volunteer_experience", "story", "preference", "career_goal", "value", "experience_detail"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Summary<textarea disabled={candidate.status !== "pending"} rows={3} value={candidate.proposed_summary} onChange={(e) => editCandidate(candidate.id, { proposed_summary: e.target.value })} /></label>
          <div className="grid two">
            <label>Organization<input disabled={candidate.status !== "pending"} value={candidate.proposed_details.organization || ""} onChange={(e) => editCandidate(candidate.id, { proposed_details: { ...candidate.proposed_details, organization: e.target.value } })} /></label>
            <label>Role<input disabled={candidate.status !== "pending"} value={candidate.proposed_details.role || ""} onChange={(e) => editCandidate(candidate.id, { proposed_details: { ...candidate.proposed_details, role: e.target.value } })} /></label>
          </div>
          <label>Actions (one per line)<textarea disabled={candidate.status !== "pending"} rows={2} value={(candidate.proposed_details.actions || []).join("\n")} onChange={(e) => editCandidate(candidate.id, { proposed_details: { ...candidate.proposed_details, actions: e.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } })} /></label>
          <label>Results (one per line)<textarea disabled={candidate.status !== "pending"} rows={2} value={(candidate.proposed_details.results || []).join("\n")} onChange={(e) => editCandidate(candidate.id, { proposed_details: { ...candidate.proposed_details, results: e.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } })} /></label>
          <label>Skills / tags (comma-separated)<input disabled={candidate.status !== "pending"} value={candidate.proposed_tags.join(", ")} onChange={(e) => editCandidate(candidate.id, { proposed_tags: e.target.value.split(",").map((value) => value.trim()).filter(Boolean), proposed_details: { ...candidate.proposed_details, skills: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} /></label>
          <details><summary>Source and structured details</summary><blockquote>{candidate.source_text}</blockquote><pre>{JSON.stringify(candidate.proposed_details, null, 2)}</pre>{candidate.possible_match_id && <p className="warningText">Possible existing match: {candidate.possible_match_id}. Approval will update/merge only after your confirmation.</p>}</details>
          {candidate.status === "pending" && <>
            <div className="candidateChoices">
              <label><input type="checkbox" checked={candidateChoices[candidate.id]?.useNow || false} onChange={(e) => setCandidateChoices((choices) => ({ ...choices, [candidate.id]: { ...(choices[candidate.id] || { useNow: false, saveFuture: false }), useNow: e.target.checked } }))} />Use in this cover letter</label>
              <label><input type="checkbox" checked={candidateChoices[candidate.id]?.saveFuture || false} onChange={(e) => setCandidateChoices((choices) => ({ ...choices, [candidate.id]: { ...(choices[candidate.id] || { useNow: false, saveFuture: false }), saveFuture: e.target.checked } }))} />Save to my knowledge base</label>
            </div>
            <div className="row wrap"><button type="button" onClick={() => void approveCandidate(candidate)} disabled={!candidateChoices[candidate.id]?.useNow && !candidateChoices[candidate.id]?.saveFuture}>Approve / Edit and approve</button><button type="button" onClick={() => void rejectCandidate(candidate)}>Reject</button></div>
          </>}
        </div>)}

        <div className="row wrap">
          <button type="button" onClick={() => void buildCurrentContentPlan().catch((err) => setError((err as Error).message))}>Prepare Content Plan</button>
        </div>
        {contentPlan && <div className="candidateCard"><h3>Content plan</h3>{contentPlan.paragraphs.map((paragraph, index) => <p key={`${paragraph.purpose}-${index}`}><strong>{paragraph.purpose}</strong><br /><span className="muted">Sources: {paragraph.source_ids.join(", ") || "none"}</span></p>)}{contentPlan.warnings.map((warning) => <p className="warningText" key={warning}>{warning}</p>)}</div>}

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
                  const missingEvidence = item.resume_evidence.length === 0 && item.source_ids.length === 0;
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
                      {item.source_ids.length > 0 && <p className="muted"><strong>Internal sources:</strong> {item.source_ids.join(", ")}</p>}
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
          <button type="button" className="nextWorkflowCta" onClick={() => void handleCompleteAndNextJob()}>
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
          <button
            type="button"
            className="menuToggle"
            onClick={() => setIsSideRailOpen(true)}
            aria-label="Open navigation"
            title="Open navigation"
          >
            <span />
            <span />
            <span />
          </button>
          <div className="headerCopy">
            <p className="eyebrow">{appMode === "intake" ? "Workspace setup" : appMode === "knowledge" ? "Personal evidence library" : `Step ${currentStep} of ${STEPS.length}`}</p>
            <h1>{appMode === "knowledge" ? "Knowledge Base" : "Cover Letter Agent"}</h1>
          </div>
        </div>
        <p className="headerDescription">
          {appMode === "intake" ? "Connect a model, optionally import a resume, or begin with an empty profile."
            : appMode === "knowledge" ? "Review the user-verified facts available to future applications."
            : "Build a tailored, evidence-grounded application one step at a time."}
        </p>
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

          {appMode === "knowledge" ? (
            <KnowledgeBase onClose={() => setAppMode(intakeCompleted ? "pipeline" : "intake")} />
          ) : appMode === "intake" ? (
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

      <>
        <button
          type="button"
          className={`navOverlay ${isSideRailOpen ? "open" : ""}`}
          aria-label="Close navigation"
          onClick={() => setIsSideRailOpen(false)}
        />

        <aside className={`leftDrawer ${isSideRailOpen ? "open" : ""}`} aria-label="Application navigation">
          <div className="leftDrawerBody">
            <div>
              <div className="leftDrawerBrand">
                <span className="brandMark" aria-hidden="true">CL</span>
                <div>
                  <p>Cover Letter Agent</p>
                  <span>Private drafting workspace</span>
                </div>
                <button
                  type="button"
                  className="leftDrawerClose"
                  onClick={() => setIsSideRailOpen(false)}
                  aria-label="Close navigation"
                >
                  ×
                </button>
              </div>

              {appMode === "pipeline" ? (
                <>
                  <div className="leftDrawerHeader">
                    <h2>Workflow</h2>
                  </div>
                  <WizardStepper
                    steps={STEPS as unknown as Array<{ id: number; title: string }>}
                    currentStep={currentStep}
                    onSelectStep={goToStep}
                    canAccessStep={canAccessStep}
                  />
                </>
              ) : (
                <div className="intakeNavCard" aria-current="step">
                  <span className="intakeNavIcon">1</span>
                  <div>
                    <strong>Workspace setup</strong>
                    <span>Model and source files</span>
                  </div>
                </div>
              )}
            </div>

              <div className="drawerFooter">
              <div className="drawerSettings">
                <button type="button" onClick={() => { setAppMode("knowledge"); setIsSideRailOpen(false); }}>Open Knowledge Base</button>
                {intakeCompleted && <button type="button" onClick={() => { setIsSideRailOpen(false); void handleCompleteAndNextJob(); }}>Start New Application</button>}
              </div>
              {appMode === "pipeline" && (
                <div className="drawerSettings">
                  <h3>Model settings</h3>
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
              )}
              <p className="sidebarPrivacy">
                Settings stay in your browser; verified knowledge and application sessions stay in local SQLite. Content only leaves your device when you choose a hosted model.
              </p>
            </div>
          </div>
        </aside>
      </>

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

      <details className="panel devPanel">
        <summary>Developer output</summary>
        <div className="debugGrid">
          <label>
            Draft response
            <textarea readOnly value={rawOutput} rows={6} placeholder="Draft model output..." />
          </label>
          <label>
            Memory response
            <textarea readOnly value={rawMemoryOutput} rows={6} placeholder="Memory model output..." />
          </label>
          <label>
            Interview tips response
            <textarea readOnly value={rawInterviewOutput} rows={6} placeholder="Interview tips model output..." />
          </label>
        </div>
        <p className="muted">Last draft fingerprint: {lastDraftKey ? "generated" : "none"} | Last tips fingerprint: {lastTipsKey ? "generated" : "none"}</p>
      </details>
    </div>
  );
}

export default App;
