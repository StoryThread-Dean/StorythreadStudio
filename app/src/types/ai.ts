// types/ai.ts -- TypeScript Types for the AI System
// ====================================================
// Mirrors the Pydantic models in backend/app/routers/ai.py and settings.py

// ── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  openrouter_api_key: string;   // Masked display value ("sk-or-...xyz" or "")
  openrouter_api_key_set: boolean;
  default_model: string;
  content_mode: string;
  cost_tier: string;
}

export interface UpdateSettingsPayload {
  openrouter_api_key?: string;
  default_model?: string;
  content_mode?: string;
  cost_tier?: string;
}

// ── Models ────────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  cost_input_per_million: number;
  cost_output_per_million: number;
}

// ── Assistants ────────────────────────────────────────────────────────────────

export interface AssistantMeta {
  id: string;
  name: string;
  category: string;
  scope: string;
  description: string;
}

export interface AssistantSuggestion {
  label: string;
  content: string;
}

export interface AssistantResponse {
  assistant_id: string;
  assistant_name: string;
  summary: string;
  suggestions: AssistantSuggestion[];
  notes: string[];
  model_used: string;
  had_em_dashes: boolean;
}

export interface RunAssistantPayload {
  assistant_id: string;
  selected_text: string;
  model_id?: string;
}
