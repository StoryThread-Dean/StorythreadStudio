# 05. API, UI, and Data Models

## Frontend Screen Plan

### 1. Project Home
- create project
- open project
- recent projects

### 2. Main Writing Screen

#### Left Panel
- chapters
- notes
- profiles

#### Center Panel
- Markdown editor
- one chapter at a time

#### Right Panel
- assistant category tabs
- assistant buttons
- attached context chips
- AI response output
- copy button

### 3. Profile Browser
- search
- filter by type
- open profile
- import and fork character profile

### 4. Profile Builder

#### Left
- profile navigation
- section list

#### Center
- structured editor
- generated AI content fields
- notes fields
- generate section summary
- generate full profile summary
- generate AI usage example

#### Right
- profile calibration chat
- short focused replies
- 1 to 4 follow-up questions when needed

### 5. Settings
- OpenRouter API key
- default model
- routing enabled
- content mode behavior
- cost tier
- model allowlist and blocklist
- debug options

## FastAPI Endpoints

### Projects
```text
POST   /api/projects/create
POST   /api/projects/open
GET    /api/projects/{project_id}
POST   /api/projects/{project_id}/snapshot
POST   /api/projects/{project_id}/export-manuscript
```

### Documents
```text
GET    /api/projects/{project_id}/documents
GET    /api/documents/{document_id}
PUT    /api/documents/{document_id}
POST   /api/projects/{project_id}/documents/create
DELETE /api/documents/{document_id}
```

### Profiles
```text
GET    /api/projects/{project_id}/profiles
GET    /api/profiles/{profile_id}
PUT    /api/profiles/{profile_id}
POST   /api/projects/{project_id}/profiles/create
POST   /api/projects/{project_id}/profiles/import-fork
DELETE /api/profiles/{profile_id}
```

### Profile Builder
```text
POST   /api/profiles/{profile_id}/generate-section-summary
POST   /api/profiles/{profile_id}/generate-full-summary
POST   /api/profiles/{profile_id}/generate-ai-usage-example
POST   /api/profiles/{profile_id}/builder-chat
```

### AI
```text
POST   /api/ai/run-assistant
POST   /api/ai/test-connection
GET    /api/ai/models
POST   /api/ai/route-preview
```

### Settings
```text
GET    /api/settings
PUT    /api/settings
POST   /api/settings/openrouter-key
```

## SQLite Schema

### Projects
```sql
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  root_path TEXT NOT NULL,
  content_mode_default TEXT NOT NULL,
  default_model TEXT,
  model_routing_enabled INTEGER NOT NULL DEFAULT 1,
  allow_explicit_routing INTEGER NOT NULL DEFAULT 1,
  cost_tier TEXT NOT NULL DEFAULT 'balanced',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Documents
```sql
CREATE TABLE documents (
  document_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sort_order INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(project_id)
);
```

### Profiles
```sql
CREATE TABLE profiles (
  profile_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  profile_type TEXT NOT NULL,
  name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  imported_from_project_id TEXT,
  imported_from_profile_id TEXT,
  imported_from_profile_name TEXT,
  imported_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(project_id)
);
```

### Trait Blocks
```sql
CREATE TABLE profile_trait_blocks (
  trait_block_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  section_name TEXT NOT NULL,
  trait_text TEXT NOT NULL,
  description_text TEXT NOT NULL,
  influence_level TEXT,
  ai_usage_example TEXT,
  notes_text TEXT,
  display_order INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES profiles(profile_id)
);
```

### AI Summaries
```sql
CREATE TABLE profile_ai_summaries (
  summary_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  section_name TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  is_full_profile_summary INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES profiles(profile_id)
);
```

### Settings
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Model Registry Cache
```sql
CREATE TABLE model_registry_cache (
  model_id TEXT PRIMARY KEY,
  display_name TEXT,
  supports_structured_output INTEGER,
  max_context_tokens INTEGER,
  content_modes TEXT,
  cost_input_per_million REAL,
  cost_output_per_million REAL,
  last_checked_at TEXT NOT NULL
);
```

### Assistant Registry
```sql
CREATE TABLE assistant_registry (
  assistant_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  output_schema_name TEXT NOT NULL,
  system_prompt_template TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
```

### Interaction Log
```sql
CREATE TABLE interaction_log (
  interaction_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  document_path TEXT,
  selected_text_hash TEXT,
  attached_context_json TEXT,
  request_type TEXT NOT NULL,
  response_summary TEXT,
  created_at TEXT NOT NULL
);
```

## Important Data Rule

The app should store generated AI text only in designated generated-content fields or logs.  
It should not auto-overwrite:
- human profile descriptions
- notes
- chapter prose
- story draft text
