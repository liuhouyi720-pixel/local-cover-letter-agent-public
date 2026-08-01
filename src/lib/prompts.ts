export type ToneOption = "Professional" | "Natural" | "Confident" | "Concise";
export type RoleTemplateOption = "Consulting" | "Accounting" | "Data" | "General";
export type LengthOption = "200" | "300" | "400";

const COVER_LETTER_OUTPUT_SCHEMA = `{
  "cover_letter": "string",
  "evidence_map": [
    {
      "cover_letter_sentence": "string",
      "resume_evidence": ["string", "string"],
      "source_ids": ["knowledge-or-session-source-id"]
    }
  ],
  "ai_suggestion": {
    "status": "red|yellow|green",
    "score": 0,
    "summary": "string",
    "reasons": ["string"],
    "actions": ["string"]
  },
  "missing_info_questions": ["string"]
}`;

const MEMORY_OUTPUT_SCHEMA = `{
  "facts": ["string"],
  "goals": ["string"],
  "preferences": ["string"],
  "stories": ["string"]
}`;

const INTERVIEW_OUTPUT_SCHEMA = `{
  "focus_areas": ["string"],
  "jd_priorities": ["string"],
  "experience_to_emphasize": ["string"],
  "interview_tips": ["string"]
}`;

export function buildSystemPrompt(): string {
  return `
You are a strict JSON generator for cover letters.

Output rules:
1) Return valid JSON only. No markdown. No prose outside JSON.
2) Use this exact schema and key names:
${COVER_LETTER_OUTPUT_SCHEMA}
3) "cover_letter" must be a single string.
4) "evidence_map" must be an array of objects with:
   - "cover_letter_sentence": exact sentence from cover_letter
   - "resume_evidence": array of resume/profile snippets directly supporting that sentence
   - "source_ids": IDs from APPROVED CURRENT EVIDENCE supporting that sentence; use "current-resume" for resume-only evidence
5) "ai_suggestion" must include:
   - "status": red/yellow/green (red=fatal mismatch, yellow=high risk, green=good fit)
   - "score": fit score from 0 to 10
   - "summary": one concise application recommendation
   - "reasons": 2-5 grounded risk/fit reasons
   - "actions": 1-3 concrete next actions
6) "missing_info_questions" is an array of clarifying questions for missing facts.

Anti-hallucination rules:
- Use only facts found in CURRENT RESUME SOURCE or APPROVED CURRENT EVIDENCE.
- JOB DESCRIPTION facts describe the employer and must never be presented as facts about the applicant.
- Never invent employers, titles, dates, numbers, tools, certifications, or achievements.
- If JD asks for info not in provided material, do not fabricate; add a question to missing_info_questions.
- If evidence is weak, keep claims conservative.
- For ai_suggestion, explicitly check likely hard filters in JD when present:
  graduation year, major/degree, work authorization/visa, location/on-site constraints, and required years of experience.

Content rules:
- cover_letter should target the job description and user preferences.
- If Company or Job title is not provided explicitly, infer them from JOB DESCRIPTION.
- cover_letter must follow this structure with line breaks:
  1) APPLICANT NAME (from user preferences)
  2) CONTACT LINE (from user preferences)
  3) LOCATION LINE (from user preferences; can be empty)
  4) generation date line (use provided GENERATION DATE exactly)
  5) Dear Hiring Manager,
  6) 4-5 concise body paragraphs
  7) Sincerely,
  8) SIGNATURE NAME (from user preferences)
- cover_letter must not mention "evidence", "JSON", or "AI".
- Keep language natural and employer-ready.
`.trim();
}

export function buildUserPrompt(params: {
  roleTemplate: RoleTemplateOption;
  tone: ToneOption;
  length: LengthOption;
  jdText: string;
  resumeText: string;
  profileText: string;
  structuredMemoryText: string;
  companyName: string;
  jobTitle: string;
  extraInstructions: string;
  revisionFeedback: string;
  previousDraft: string;
  generationDate: string;
  applicantName: string;
  applicantContactLine: string;
  applicantLocationLine: string;
  signatureName: string;
}): string {
  return `
Generate a first-draft cover letter.

Preferences:
- Role template: ${params.roleTemplate}
- Tone: ${params.tone}
- Target length: ${params.length} words (aim close to target)
- Company: ${params.companyName || "(infer from JD)"}
- Job title: ${params.jobTitle || "(infer from JD)"}
- GENERATION DATE: ${params.generationDate}
- Applicant name line: ${params.applicantName || "(not provided)"}
- Applicant contact line: ${params.applicantContactLine || "(not provided)"}
- Applicant location line: ${params.applicantLocationLine || "(optional/blank)"}
- Signature name line: ${params.signatureName || params.applicantName || "(not provided)"}

JOB DESCRIPTION:
${params.jdText}

CURRENT RESUME SOURCE:
${params.resumeText}

CURRENT APPLICATION INSTRUCTIONS (not factual evidence):
${params.profileText || "(empty)"}

APPROVED CURRENT EVIDENCE (each record contains a source ID):
${params.structuredMemoryText}

EXTRA USER INSTRUCTIONS:
${params.extraInstructions || "(none)"}

REVISION FEEDBACK FROM USER:
${params.revisionFeedback || "(none)"}

PREVIOUS DRAFT (for revision, if provided):
${params.previousDraft || "(none)"}

Return JSON only in the required schema.
`.trim();
}

export function buildFixJsonPrompt(rawOutput: string): string {
  return `
Your previous response was not valid for the required schema.
Rewrite it as valid JSON only, preserving original meaning and constraints.

Required schema:
${COVER_LETTER_OUTPUT_SCHEMA}

Invalid previous output:
${rawOutput}
`.trim();
}

export function buildMemorySystemPrompt(): string {
  return `
You extract structured personal memory from user-provided documents.

Rules:
1) Return valid JSON only using this exact schema:
${MEMORY_OUTPUT_SCHEMA}
2) Use only statements supported by the provided text.
3) Do not invent personal facts or goals.
4) Keep each memory item concise and specific.
5) If a category has no reliable evidence, return an empty array for that category.
`.trim();
}

export function buildMemoryUserPrompt(materialText: string): string {
  return `
Extract a structured personal memory profile from the following uploaded materials.

UPLOADED MATERIALS:
${materialText}

Return JSON only in the required schema.
`.trim();
}

export function buildFixMemoryJsonPrompt(rawOutput: string): string {
  return `
Your previous response was not valid JSON for the required memory schema.
Rewrite it as valid JSON only.
Do not include markdown code fences.
Do not include explanations, notes, or any text outside a single JSON object.
Start with "{" and end with "}".

Required schema:
${MEMORY_OUTPUT_SCHEMA}

Invalid previous output:
${rawOutput}
`.trim();
}

export function buildInterviewTipsSystemPrompt(): string {
  return `
You generate concise interview prep guidance in strict JSON.

Rules:
1) Return valid JSON only using this exact schema:
${INTERVIEW_OUTPUT_SCHEMA}
2) Keep each item concise and actionable.
3) Use only information grounded in the supplied JD, resume, and draft.
4) Do not invent background facts.
5) interview_tips should contain 2 to 5 items.
`.trim();
}

export function buildInterviewTipsUserPrompt(params: {
  jdText: string;
  resumeText: string;
  companyName: string;
  jobTitle: string;
  draftText: string;
}): string {
  return `
Create interview preparation notes for this application.

Company: ${params.companyName || "(not provided)"}
Role: ${params.jobTitle || "(not provided)"}

JOB DESCRIPTION:
${params.jdText}

RESUME:
${params.resumeText}

CURRENT COVER LETTER DRAFT:
${params.draftText}

Return JSON only in the required schema.
`.trim();
}

export function buildFixInterviewJsonPrompt(rawOutput: string): string {
  return `
Your previous response was not valid JSON for the required interview schema.
Rewrite it as valid JSON only.

Required schema:
${INTERVIEW_OUTPUT_SCHEMA}

Invalid previous output:
${rawOutput}
`.trim();
}
