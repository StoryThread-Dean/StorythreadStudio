// utils/modelFiltering.ts -- Shared model-picker logic
// =====================================================
// Both the global Settings screen and the per-project Project Settings screen
// show an OpenRouter model picker, and both need the SAME two things:
//   1. A content-mode filter (general / mature / explicit) so we don't offer a
//      moderated model to someone writing explicit content (it would refuse or
//      soften the prose).
//   2. A curated "Recommended" list of known-good current models pinned at the
//      top of the picker.
// These used to be copy-pasted into Settings.tsx AND ProjectSettings.tsx, which
// drifted apart. This module is the single source of truth for both.

import type { ModelInfo } from "../types/ai";

// ── Content-mode provider lists ───────────────────────────────────────────────
// Providers whose models are content-moderated (they refuse or heavily soften
// explicit/dark content). Hidden in "mature" mode.
export const MODERATED_PROVIDERS = [
  "openai/", "anthropic/", "google/", "cohere/",
];

// Providers known to allow explicit/unmoderated prose. In "explicit" mode we
// show ONLY these (a whitelist), because everything else tends to refuse.
export const EXPLICIT_ALLOWED_PROVIDERS = [
  "mistralai/", "deepseek/", "x-ai/", "meta-llama/", "qwen/",
  "nothingiisreal/", "nousresearch/", "cognitivecomputations/",
  "thedrummer/", "sao10k/", "anthracite-org/", "venice/",
  "eva-unit-01/", "microsoft/", "01-ai/", "liquid/", "ai21/",
];

// Returns true if a model should be OFFERED for the given content mode.
//   general  -> everything
//   mature   -> hide content-moderated providers + any flagged is_moderated
//   explicit -> show only the unmoderated-provider whitelist
export function filterModelByContentMode(m: ModelInfo, mode: string): boolean {
  if (mode === "general") return true;
  if (mode === "mature") {
    if (m.is_moderated) return false;
    return !MODERATED_PROVIDERS.some(p => m.id.startsWith(p));
  }
  if (mode === "explicit") {
    return EXPLICIT_ALLOWED_PROVIDERS.some(p => m.id.startsWith(p));
  }
  return true;
}

// ── Recommended models ──────────────────────────────────────────────────────
// A curated list of current, known-good models for fiction writing, pinned at
// the top of the picker. IDs are OpenRouter model slugs.
//
// CRITICAL: this is cross-referenced against the LIVE model list before display
// (see Settings.tsx availableRecommended), so a slug that OpenRouter deprecates
// silently disappears instead of producing a 404 later. Still, refresh this list
// when cutting a release -- a recommendation that no longer exists just vanishes,
// which is safe but unhelpful.
//
// The list intentionally spans price tiers AND content modes. In explicit/mature
// mode the moderated-provider entries (Anthropic/OpenAI) are filtered out by
// filterModelByContentMode, leaving the unmoderated picks (Mistral, xAI, Sao10K,
// DeepSeek, Llama) -- so explicit writers still see a useful spread.
export const RECOMMENDED_MODELS: { id: string; note: string }[] = [
  // Premium -- best prose quality (moderated: general/mature only)
  { id: "anthropic/claude-opus-4.8",              note: "Top prose quality"           },
  { id: "anthropic/claude-sonnet-4.6",            note: "Excellent prose, great value" },
  // Fast + affordable quality
  { id: "anthropic/claude-haiku-4.5",             note: "Fast, strong, affordable"    },
  { id: "openai/gpt-4.1-mini",                    note: "Fast, capable, low cost"     },
  // Budget
  { id: "deepseek/deepseek-chat",                 note: "Best budget quality"          },
  // Unmoderated -- best for mature / explicit fiction
  { id: "mistralai/mistral-large",                note: "Strong, unmoderated prose"    },
  { id: "x-ai/grok-4.3",                          note: "Vivid, unmoderated"           },
  { id: "sao10k/l3.3-euryale-70b",                note: "Tuned for immersive fiction"  },
  { id: "mistralai/mistral-nemo",                 note: "Budget, unmoderated"          },
  // Free
  { id: "meta-llama/llama-3.3-70b-instruct:free", note: "Best free option"             },
];
