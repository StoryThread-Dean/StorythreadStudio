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

// ── Cost tiers ────────────────────────────────────────────────────────────────
// Four explicit stops shared by the global Settings slider and the per-project
// tier select. The stored VALUES ("free"/"budget"/"standard"/"premium") are
// frozen -- they live in settings.json and project.json files on user machines,
// so only the display labels may change.
//
// Each tier is a price CAP: it filters the picker down to models at or below
// that input cost. "Priority Best" (the top stop) shows everything and pins a
// Flagship group at the top of the picker for one-click access to the
// strongest models.
export const TIERS = [
  { value: "free",     label: "Free",          help: "Free models only" },
  { value: "budget",   label: "Lowest",        help: "Up to $1/M input" },
  { value: "standard", label: "Pricier",       help: "Up to $15/M input" },
  { value: "premium",  label: "Priority Best", help: "All models; flagship picks pinned on top" },
] as const;

export type TierValue = (typeof TIERS)[number]["value"];

export function tierIndex(value: TierValue): number {
  return TIERS.findIndex(t => t.value === value);
}

// Price-cap filter applied to the model list to compute what the picker shows.
export function modelPassesTier(m: ModelInfo, tier: string): boolean {
  if (tier === "free")     return m.is_free;
  if (tier === "budget")   return m.cost_input_per_million <= 1.0;
  if (tier === "standard") return m.cost_input_per_million <= 15.0;
  return true; // premium ("Priority Best"): everything
}

// ── Media-capability filter ───────────────────────────────────────────────────
// True when a model outputs text only (or doesn't declare modalities, which in
// practice means text). Used with the text_only_filter setting to keep image /
// audio / video output models out of the pickers.
export function modelIsTextOnly(m: ModelInfo): boolean {
  return m.output_modalities.length === 0
    || m.output_modalities.every(mod => mod === "text");
}

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

// NanoGPT content-mode heuristic. The prefix lists above are OpenRouter slug
// conventions ("anthropic/...") and won't match NanoGPT's catalog ids, so for
// NanoGPT we use a small substring BLOCKLIST instead: NanoGPT's catalog is
// largely unmoderated-friendly, and whitelisting unknown slugs would hide
// everything. This is a heuristic -- "gpt" or "claude" appearing in an id
// usually means a moderated upstream family, but could over-block an odd
// fine-tune. The backend never blocks on this; it only shapes the picker.
export const MODERATED_NAME_FRAGMENTS = [
  "gpt", "chatgpt", "openai", "claude", "gemini", "command",
];

function nanogptLooksModerated(m: ModelInfo): boolean {
  const haystack = (m.id + " " + m.name).toLowerCase();
  return MODERATED_NAME_FRAGMENTS.some(f => haystack.includes(f));
}

// Returns true if a model should be OFFERED for the given content mode.
// OpenRouter (default):
//   general  -> everything
//   mature   -> hide content-moderated providers + any flagged is_moderated
//   explicit -> show only the unmoderated-provider whitelist
// NanoGPT:
//   general  -> everything
//   mature / explicit -> hide models whose id/name suggests a moderated
//   upstream family (see MODERATED_NAME_FRAGMENTS above)
export function filterModelByContentMode(
  m: ModelInfo,
  mode: string,
  provider: string = "openrouter",
): boolean {
  if (mode === "general") return true;
  if (provider === "nanogpt") {
    return !nanogptLooksModerated(m);
  }
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
// `flagship` marks the strongest-in-class picks that get pinned in their own
// group when the cost tier is at the top "Priority Best" stop.
export const RECOMMENDED_MODELS: { id: string; note: string; flagship?: boolean }[] = [
  // Flagship -- best prose quality (moderated entries: general/mature only)
  { id: "anthropic/claude-opus-4.8",              note: "Top prose quality",           flagship: true },
  { id: "anthropic/claude-sonnet-4.6",            note: "Excellent prose, great value", flagship: true },
  // Fast + affordable quality
  { id: "anthropic/claude-haiku-4.5",             note: "Fast, strong, affordable"    },
  { id: "openai/gpt-4.1-mini",                    note: "Fast, capable, low cost"     },
  // Budget
  { id: "deepseek/deepseek-chat",                 note: "Best budget quality"          },
  // Unmoderated -- best for mature / explicit fiction
  { id: "mistralai/mistral-large",                note: "Strong, unmoderated prose",   flagship: true },
  { id: "x-ai/grok-4.3",                          note: "Vivid, unmoderated",          flagship: true },
  { id: "sao10k/l3.3-euryale-70b",                note: "Tuned for immersive fiction"  },
  { id: "mistralai/mistral-nemo",                 note: "Budget, unmoderated"          },
  // Free
  { id: "meta-llama/llama-3.3-70b-instruct:free", note: "Best free option"             },
];
