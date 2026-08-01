PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_knowledge_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  verified_by_user INTEGER NOT NULL CHECK (verified_by_user IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'archived')),
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_tags (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  tag_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(profile_id, normalized_name, tag_type)
);

CREATE TABLE IF NOT EXISTS knowledge_item_tags (
  knowledge_item_id TEXT NOT NULL REFERENCES personal_knowledge_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (knowledge_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS application_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  company_name TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  parsed_requirements_json TEXT NOT NULL DEFAULT '[]',
  user_instructions TEXT NOT NULL DEFAULT '',
  selected_knowledge_json TEXT NOT NULL DEFAULT '[]',
  content_plan_json TEXT,
  draft TEXT NOT NULL DEFAULT '',
  final_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  application_session_id TEXT NOT NULL REFERENCES application_sessions(id) ON DELETE CASCADE,
  candidate_action TEXT NOT NULL CHECK (candidate_action IN ('create', 'update', 'merge', 'conflict')),
  proposed_category TEXT NOT NULL,
  proposed_title TEXT NOT NULL,
  proposed_summary TEXT NOT NULL,
  proposed_details_json TEXT NOT NULL,
  proposed_tags_json TEXT NOT NULL DEFAULT '[]',
  source_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL DEFAULT '',
  possible_match_id TEXT REFERENCES personal_knowledge_items(id),
  use_in_current INTEGER NOT NULL DEFAULT 0 CHECK (use_in_current IN (0, 1)),
  save_for_future INTEGER NOT NULL DEFAULT 0 CHECK (save_for_future IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'edited_and_approved', 'rejected', 'expired')),
  approved_knowledge_item_id TEXT REFERENCES personal_knowledge_items(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  id TEXT PRIMARY KEY,
  knowledge_item_id TEXT NOT NULL REFERENCES personal_knowledge_items(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_type TEXT NOT NULL,
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(knowledge_item_id, version_number)
);

CREATE TABLE IF NOT EXISTS knowledge_usage (
  id TEXT PRIMARY KEY,
  application_session_id TEXT NOT NULL REFERENCES application_sessions(id) ON DELETE CASCADE,
  knowledge_item_id TEXT REFERENCES personal_knowledge_items(id),
  memory_candidate_id TEXT REFERENCES memory_candidates(id),
  usage_status TEXT NOT NULL CHECK (usage_status IN ('retrieved', 'recommended', 'selected', 'used_in_draft', 'removed_by_user', 'not_used')),
  requirement_id TEXT,
  selection_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_profile_status ON personal_knowledge_items(profile_id, status, verified_by_user);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON personal_knowledge_items(category);
CREATE INDEX IF NOT EXISTS idx_candidate_session_status ON memory_candidates(application_session_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_session ON knowledge_usage(application_session_id);
CREATE INDEX IF NOT EXISTS idx_version_item ON knowledge_versions(knowledge_item_id, version_number DESC);
