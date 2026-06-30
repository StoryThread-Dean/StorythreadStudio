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
});
