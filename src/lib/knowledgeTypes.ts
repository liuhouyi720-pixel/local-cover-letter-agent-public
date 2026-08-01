export const KNOWLEDGE_CATEGORIES = [
  "education", "work_experience", "project", "skill", "achievement",
  "volunteer_experience", "story", "preference", "career_goal", "value", "experience_detail"
] as const;

export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number];
export type KnowledgeStatus = "active" | "disabled" | "archived";
export type CandidateAction = "create" | "update" | "merge" | "conflict";
export type CandidateStatus = "pending" | "approved" | "edited_and_approved" | "rejected" | "expired";

export type KnowledgeDetails = {
  organization?: string;
  role?: string;
  actions?: string[];
  results?: string[];
  skills?: string[];
  target_roles?: string[];
  usable_for?: string[];
  reflection?: string;
  dates?: { start?: string; end?: string };
  related_knowledge_item_id?: string;
};

export type KnowledgeTag = { name: string; tag_type: string };

export type KnowledgeItem = {
  id: string;
  profile_id: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  details: KnowledgeDetails;
  source_type: string;
  source_reference: string;
  source_text: string;
  verified_by_user: boolean;
  status: KnowledgeStatus;
  valid_from: string | null;
  valid_to: string | null;
  tags: KnowledgeTag[];
  created_at: string;
  updated_at: string;
};

export type KnowledgeInput = {
  category: KnowledgeCategory;
  title: string;
  summary: string;
  details: KnowledgeDetails;
  tags: string[];
  source_type?: string;
  source_reference?: string;
  source_text?: string;
  status?: KnowledgeStatus;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type JobRequirement = {
  id: string;
  text: string;
  kind: string;
  priority: "required" | "preferred" | "context";
  keywords: string[];
};

export type MemoryCandidate = {
  id: string;
  application_session_id: string;
  candidate_action: CandidateAction;
  proposed_category: KnowledgeCategory;
  proposed_title: string;
  proposed_summary: string;
  proposed_details: KnowledgeDetails;
  proposed_tags: string[];
  source_text: string;
  source_type: string;
  source_reference: string;
  possible_match_id: string | null;
  use_in_current: boolean;
  save_for_future: boolean;
  status: CandidateStatus;
  approved_knowledge_item_id: string | null;
};

export type CandidateProposal = Omit<MemoryCandidate,
  "id" | "application_session_id" | "status" | "approved_knowledge_item_id" | "use_in_current" | "save_for_future">;

export type RankedKnowledge = {
  knowledge_item_id: string;
  matched_requirement_ids: string[];
  reason: string;
  score: number;
};

export type ContentPlan = {
  selections: Array<{
    source_type: "knowledge" | "session_candidate";
    source_id: string;
    matched_requirement_ids: string[];
    reason: string;
  }>;
  paragraphs: Array<{ purpose: string; source_ids: string[] }>;
  uncovered_requirement_ids: string[];
  warnings: string[];
};

export type ApplicationSession = {
  id: string;
  company_name: string;
  job_title: string;
  job_description: string;
  parsed_requirements: JobRequirement[];
  user_instructions: string;
  selected_knowledge: string[];
  content_plan: ContentPlan | null;
  draft: string;
  final_text: string;
  status: string;
};
