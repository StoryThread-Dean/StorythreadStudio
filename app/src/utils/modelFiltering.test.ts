// modelFiltering.test.ts
// =======================
// Two screens (Settings + ProjectSettings) depend on this shared filter to
// decide which models are safe to offer per content mode. A regression here
// could offer a content-moderated model to an explicit-fiction writer (it would
// refuse/soften their prose) or hide everything. Lock the behavior down.

import { describe, it, expect } from "vitest";
import {
  filterModelByContentMode,
  RECOMMENDED_MODELS,
  MODERATED_PROVIDERS,
  EXPLICIT_ALLOWED_PROVIDERS,
  TIERS,
  tierIndex,
  modelPassesTier,
  modelIsTextOnly,
  modelTier,
  recommendedPicks,
} from "./modelFiltering";
import type { ModelInfo } from "../types/ai";

// Minimal ModelInfo factory -- only the fields the filter reads matter.
function model(id: string, opts: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    context_length: 8000,
    cost_input_per_million: 1,
    cost_output_per_million: 1,
    output_modalities: ["text"],
    is_free: false,
    is_moderated: false,
    supports_reasoning: false,
    ...opts,
  };
}

describe("filterModelByContentMode", () => {
  it("general mode shows everything, including moderated providers", () => {
    expect(filterModelByContentMode(model("openai/gpt-4.1-mini"), "general")).toBe(true);
    expect(filterModelByContentMode(model("mistralai/mistral-large"), "general")).toBe(true);
  });

  it("mature mode hides moderated providers and is_moderated models", () => {
    expect(filterModelByContentMode(model("anthropic/claude-opus-4.8"), "mature")).toBe(false);
    expect(filterModelByContentMode(model("x-ai/grok-4.3", { is_moderated: true }), "mature")).toBe(false);
    expect(filterModelByContentMode(model("mistralai/mistral-large"), "mature")).toBe(true);
  });

  it("explicit mode shows ONLY the unmoderated-provider whitelist", () => {
    expect(filterModelByContentMode(model("openai/gpt-4.1-mini"), "explicit")).toBe(false);
    expect(filterModelByContentMode(model("anthropic/claude-opus-4.8"), "explicit")).toBe(false);
    expect(filterModelByContentMode(model("mistralai/mistral-large"), "explicit")).toBe(true);
    expect(filterModelByContentMode(model("sao10k/l3.3-euryale-70b"), "explicit")).toBe(true);
  });

  it("unknown mode falls through to showing the model", () => {
    expect(filterModelByContentMode(model("openai/gpt-4.1-mini"), "something-else")).toBe(true);
  });

  it("defaults to the openrouter rules when no provider is given", () => {
    // Backward compatibility: both screens called this without a provider
    // argument before NanoGPT existed -- the OpenRouter prefix rules apply.
    expect(filterModelByContentMode(model("anthropic/claude-opus-4.8"), "mature")).toBe(false);
  });
});

describe("filterModelByContentMode -- nanogpt provider", () => {
  // NanoGPT ids don't follow OpenRouter's "provider/model" slug convention,
  // so the provider-prefix rules can't apply. Instead a substring blocklist
  // hides models whose id/name suggests a moderated upstream family.
  it("general mode shows everything", () => {
    expect(filterModelByContentMode(model("gpt-5.2"), "general", "nanogpt")).toBe(true);
    expect(filterModelByContentMode(model("some-local-tune"), "general", "nanogpt")).toBe(true);
  });

  it("mature and explicit hide moderated-family names", () => {
    for (const mode of ["mature", "explicit"]) {
      expect(filterModelByContentMode(model("gpt-5.2"), mode, "nanogpt")).toBe(false);
      expect(filterModelByContentMode(model("claude-sonnet"), mode, "nanogpt")).toBe(false);
      expect(filterModelByContentMode(model("gemini-pro"), mode, "nanogpt")).toBe(false);
    }
  });

  it("mature and explicit keep unmoderated-looking models", () => {
    for (const mode of ["mature", "explicit"]) {
      expect(filterModelByContentMode(model("mythomax-13b"), mode, "nanogpt")).toBe(true);
      expect(filterModelByContentMode(model("deepseek-v3"), mode, "nanogpt")).toBe(true);
    }
  });

  it("matches fragments in the display name too, case-insensitively", () => {
    const m = model("mystery-model", { name: "Repackaged ChatGPT Turbo" });
    expect(filterModelByContentMode(m, "mature", "nanogpt")).toBe(false);
  });
});

describe("RECOMMENDED_MODELS", () => {
  it("has entries and every entry has an id and a note", () => {
    expect(RECOMMENDED_MODELS.length).toBeGreaterThan(0);
    for (const rec of RECOMMENDED_MODELS) {
      expect(rec.id).toMatch(/.+\/.+/); // provider/model slug
      expect(rec.note.trim().length).toBeGreaterThan(0);
    }
  });

  it("includes at least one unmoderated pick so explicit mode is never empty", () => {
    const explicitOk = RECOMMENDED_MODELS.filter(rec =>
      EXPLICIT_ALLOWED_PROVIDERS.some(p => rec.id.startsWith(p)),
    );
    expect(explicitOk.length).toBeGreaterThan(0);
  });

  it("includes at least one moderated-provider pick for general-mode quality", () => {
    const moderated = RECOMMENDED_MODELS.filter(rec =>
      MODERATED_PROVIDERS.some(p => rec.id.startsWith(p)),
    );
    expect(moderated.length).toBeGreaterThan(0);
  });

  it("has flagship picks, including at least one unmoderated for explicit mode", () => {
    const flagships = RECOMMENDED_MODELS.filter(rec => rec.flagship);
    expect(flagships.length).toBeGreaterThan(0);
    const explicitOk = flagships.filter(rec =>
      EXPLICIT_ALLOWED_PROVIDERS.some(p => rec.id.startsWith(p)),
    );
    expect(explicitOk.length).toBeGreaterThan(0);
  });
});

describe("cost tiers", () => {
  it("defines four stops with frozen stored values in slider order", () => {
    // The VALUES are stored in settings.json / project.json on user machines;
    // renaming one silently orphans saved settings. Labels may change freely.
    expect(TIERS.map(t => t.value)).toEqual(["free", "budget", "standard", "premium"]);
    expect(tierIndex("free")).toBe(0);
    expect(tierIndex("premium")).toBe(3);
  });

  it("modelPassesTier caps by input price per tier", () => {
    const free   = model("a/free",   { is_free: true, cost_input_per_million: 0 });
    const cheap  = model("a/cheap",  { cost_input_per_million: 0.8 });
    const mid    = model("a/mid",    { cost_input_per_million: 10 });
    const flag   = model("a/flag",   { cost_input_per_million: 30 });

    expect(modelPassesTier(free,  "free")).toBe(true);
    expect(modelPassesTier(cheap, "free")).toBe(false);

    expect(modelPassesTier(cheap, "budget")).toBe(true);
    expect(modelPassesTier(mid,   "budget")).toBe(false);

    expect(modelPassesTier(mid,  "standard")).toBe(true);
    expect(modelPassesTier(flag, "standard")).toBe(false);

    // Priority Best (top stop): everything passes.
    expect(modelPassesTier(flag, "premium")).toBe(true);
  });
});

describe("modelIsTextOnly", () => {
  it("passes text-only and undeclared-modality models", () => {
    expect(modelIsTextOnly(model("a/text", { output_modalities: ["text"] }))).toBe(true);
    expect(modelIsTextOnly(model("a/none", { output_modalities: [] }))).toBe(true);
  });

  it("rejects models with image/audio/video output", () => {
    expect(modelIsTextOnly(model("a/img", { output_modalities: ["text", "image"] }))).toBe(false);
    expect(modelIsTextOnly(model("a/vid", { output_modalities: ["video"] }))).toBe(false);
  });
});

// ── Price bucketing, used by the Model Roles picker ──────────────────────────

describe("modelTier", () => {
  it("reads the same thresholds modelPassesTier caps at", () => {
    expect(modelTier(model("a/free", { is_free: true, cost_input_per_million: 0 }))).toBe("free");
    expect(modelTier(model("a/cheap", { cost_input_per_million: 0.5 }))).toBe("budget");
    expect(modelTier(model("a/mid", { cost_input_per_million: 5 }))).toBe("standard");
    expect(modelTier(model("a/top", { cost_input_per_million: 40 }))).toBe("premium");
  });

  it("puts a boundary price in the cheaper bucket, as the cap does", () => {
    expect(modelTier(model("a/one", { cost_input_per_million: 1.0 }))).toBe("budget");
    expect(modelTier(model("a/fifteen", { cost_input_per_million: 15.0 }))).toBe("standard");
  });
});

describe("recommendedPicks", () => {
  // The curated list leans expensive, so "first N" would show a writer
  // nothing but premium models and imply there is nothing cheap worth using.
  const catalog: ModelInfo[] = [
    model("meta-llama/llama-3.3-70b-instruct:free", { is_free: true, cost_input_per_million: 0 }),
    model("mistralai/mistral-nemo", { cost_input_per_million: 0.15 }),
    model("anthropic/claude-haiku-4.5", { cost_input_per_million: 1.0 }),
    model("deepseek/deepseek-chat", { cost_input_per_million: 0.9 }),
    model("anthropic/claude-sonnet-4.6", { cost_input_per_million: 3 }),
    model("mistralai/mistral-large", { cost_input_per_million: 4 }),
    model("anthropic/claude-opus-4.8", { cost_input_per_million: 20 }),
    model("x-ai/grok-4.3", { cost_input_per_million: 25 }),
    model("some/uncurated", { cost_input_per_million: 2 }),
  ];

  it("spreads the picks across price buckets rather than taking the first N", () => {
    const tiers = new Set(recommendedPicks(catalog).map(p => p.tier));
    expect(tiers.has("free")).toBe(true);
    expect(tiers.has("premium")).toBe(true);
  });

  it("returns them cheapest first", () => {
    const order = recommendedPicks(catalog).map(p => tierIndex(p.tier));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("honours the limit", () => {
    expect(recommendedPicks(catalog, 4)).toHaveLength(4);
    expect(recommendedPicks(catalog).length).toBeLessThanOrEqual(7);
  });

  it("only offers models the catalog actually has", () => {
    // A slug the provider dropped must vanish here rather than 404 later.
    const picks = recommendedPicks([catalog[0]]);
    expect(picks).toHaveLength(1);
    expect(picks[0].model.id).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("never recommends an uncurated model", () => {
    const ids = recommendedPicks(catalog).map(p => p.model.id);
    expect(ids).not.toContain("some/uncurated");
  });

  it("returns nothing for a catalog with no curated ids", () => {
    // Non-OpenRouter catalogs use different slugs. An empty group is hidden;
    // the full model list is still there underneath.
    expect(recommendedPicks([model("local/mythomax")])).toEqual([]);
  });

  it("labels each pick with its price bucket", () => {
    const labels = recommendedPicks(catalog).map(p => p.tierLabel);
    for (const label of labels) {
      expect(TIERS.map(t => t.label)).toContain(label);
    }
  });
});
