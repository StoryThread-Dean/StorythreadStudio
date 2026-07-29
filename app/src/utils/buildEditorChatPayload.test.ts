// buildEditorChatPayload.test.ts
// ==============================
// Unit tests for the pure helper that decides what materials a Writing
// Companion turn sends. Covers the three scenarios that matter for the new
// Draft mode + Continue feature:
//   - typed message, Draft mode OFF  -> category "chat"
//   - typed message, Draft mode ON   -> category "draft"
//   - Continue turn                  -> category "draft", no text, only new chips

import { describe, it, expect } from "vitest";
import { buildEditorChatPayload, appendTurnToHistory, isWeakDraftingModel, computeSurroundingWindow } from "./buildEditorChatPayload";
import type { ContextChip } from "../types/ai";

const chip = (type: string, name: string, content = "x"): ContextChip => ({ type, name, content });

// A baseline input: no selection, fresh chapter available, nothing established.
const base = {
  selectedText: "",
  fullChapterText: "The whole chapter text.",
  includeChapter: true,
  chapterEstablished: false,
  contextChips: [] as ContextChip[],
  establishedChipKeys: new Set<string>(),
};

describe("buildEditorChatPayload", () => {
  it("sends the full chapter on a first chat turn (Draft mode off)", () => {
    const out = buildEditorChatPayload({ ...base, category: "chat" });
    expect(out.category).toBe("chat");
    expect(out.text_content).toBe("The whole chapter text.");
    expect(out.is_full_chapter).toBe(true);
  });

  it("uses the draft category when Draft mode is on", () => {
    const out = buildEditorChatPayload({ ...base, category: "draft" });
    expect(out.category).toBe("draft");
    expect(out.is_full_chapter).toBe(true);
  });

  it("prefers a fresh selection over the full chapter", () => {
    const out = buildEditorChatPayload({
      ...base,
      category: "draft",
      selectedText: "  just this line  ",
    });
    expect(out.text_content).toBe("just this line");
    expect(out.is_full_chapter).toBe(false);
  });

  it("does not resend the chapter once established", () => {
    const out = buildEditorChatPayload({ ...base, category: "chat", chapterEstablished: true });
    expect(out.text_content).toBe("");
    expect(out.is_full_chapter).toBe(false);
  });

  it("omits the chapter when the include toggle is off", () => {
    const out = buildEditorChatPayload({ ...base, category: "chat", includeChapter: false });
    expect(out.text_content).toBe("");
  });

  it("Continue suppresses all text but still sends new chips", () => {
    const newChip = chip("character", "Elara");
    const out = buildEditorChatPayload({
      ...base,
      category: "draft",
      suppressText: true,
      contextChips: [newChip],
    });
    // No text even though a fresh chapter exists -- Continue leans on history.
    expect(out.text_content).toBe("");
    expect(out.is_full_chapter).toBe(false);
    // A newly attached chip still goes on the wire.
    expect(out.context_chips).toHaveLength(1);
  });

  it("does not resend an unchanged selection once established in history", () => {
    // The regression this pins: a highlight that stays active across turns was
    // rebuilt into a fresh materials block every turn, and each echo appended
    // to history -- one duplicate copy of the selection per turn, until slow
    // models hit the request timeout.
    const out = buildEditorChatPayload({
      ...base,
      category: "draft",
      selectedText: "  the same passage  ",
      establishedSelection: "the same passage",
    });
    expect(out.text_content).toBe("");
    expect(out.is_full_chapter).toBe(false);
  });

  it("resends when the selection changed since it was established", () => {
    const out = buildEditorChatPayload({
      ...base,
      category: "draft",
      selectedText: "a different passage",
      establishedSelection: "the old passage",
    });
    expect(out.text_content).toBe("a different passage");
  });

  it("an established selection does not fall through to sending the chapter", () => {
    // Selection skipped as already-in-history must mean NO text at all -- the
    // full chapter sneaking in instead would be a worse payload, not a dedup.
    const out = buildEditorChatPayload({
      ...base,
      category: "chat",
      selectedText: "the same passage",
      establishedSelection: "the same passage",
      includeChapter: true,
      chapterEstablished: false,
    });
    expect(out.text_content).toBe("");
    expect(out.is_full_chapter).toBe(false);
  });

  it("only sends chips that are not yet established", () => {
    const out = buildEditorChatPayload({
      ...base,
      category: "draft",
      contextChips: [chip("character", "Elara"), chip("location", "Keep")],
      establishedChipKeys: new Set(["character:Elara"]),
    });
    expect(out.context_chips.map((c) => c.name)).toEqual(["Keep"]);
  });
});

describe("buildEditorChatPayload (enhance mode)", () => {
  it("sends the selection as the target and carries the grounding window + level", () => {
    const out = buildEditorChatPayload({
      ...base,
      category: "enhance",
      selectedText: "  They walked to the bar.  ",
      enhanceLevel: "expanded",
      surroundingContext: "Earlier they left the safehouse.",
    });
    expect(out.category).toBe("enhance");
    expect(out.text_content).toBe("They walked to the bar.");
    expect(out.is_full_chapter).toBe(false);
    expect(out.surrounding_context).toBe("Earlier they left the safehouse.");
    expect(out.enhance_level).toBe("expanded");
  });

  it("resends the selection even when it is already established", () => {
    // Follow-up turns ("now make it darker") must keep the exact target in front
    // of the model, unlike chat/draft which stop resending established context.
    // Enhance's materials are never persisted into history (its echo is
    // suppressed backend-side), so resending is the only way the model sees it.
    const out = buildEditorChatPayload({
      ...base,
      category: "enhance",
      selectedText: "the passage",
      chapterEstablished: true,
      establishedSelection: "the passage",
      surroundingContext: "ctx",
    });
    expect(out.text_content).toBe("the passage");
    expect(out.surrounding_context).toBe("ctx");
  });

  it("defaults enhance_level to 'default' and surrounding_context to '' when omitted", () => {
    const out = buildEditorChatPayload({ ...base, category: "chat" });
    expect(out.enhance_level).toBe("default");
    expect(out.surrounding_context).toBe("");
  });
});

describe("computeSurroundingWindow", () => {
  const paras = (n: number) =>
    Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n");

  it("takes N paragraphs each side and inserts the selection marker", () => {
    const full = paras(10);
    // Select the middle paragraph (Paragraph 5).
    const target = "Paragraph 5.";
    const from = full.indexOf(target);
    const to = from + target.length;
    const win = computeSurroundingWindow(full, from, to, 2);
    expect(win).toContain("[... selected passage ...]");
    // 2 paragraphs before (3,4) and after (6,7); not the far ones.
    expect(win).toContain("Paragraph 3.");
    expect(win).toContain("Paragraph 4.");
    expect(win).toContain("Paragraph 6.");
    expect(win).toContain("Paragraph 7.");
    expect(win).not.toContain("Paragraph 1.");
    expect(win).not.toContain("Paragraph 9.");
  });

  it("respects the maxChars cap", () => {
    const full = paras(40);
    const target = "Paragraph 20.";
    const from = full.indexOf(target);
    const win = computeSurroundingWindow(full, from, from + target.length, 10, 80);
    expect(win.length).toBeLessThanOrEqual(80);
  });

  it("returns empty string when there is no surrounding text", () => {
    expect(computeSurroundingWindow("only the selection", 0, 18)).toBe("");
  });

  it("returns empty string for invalid offsets", () => {
    expect(computeSurroundingWindow("abc", 5, 2)).toBe("");
  });
});

describe("isWeakDraftingModel", () => {
  it("flags known budget tiers", () => {
    expect(isWeakDraftingModel("openai/gpt-4o-mini")).toBe(true);
    expect(isWeakDraftingModel("some/model:free")).toBe(true);
    expect(isWeakDraftingModel("anthropic/claude-haiku-4-5")).toBe(true);
  });

  it("does not flag strong models or empty values", () => {
    expect(isWeakDraftingModel("anthropic/claude-opus-4-8")).toBe(false);
    expect(isWeakDraftingModel("openai/gpt-4o")).toBe(false);
    expect(isWeakDraftingModel(null)).toBe(false);
    expect(isWeakDraftingModel(undefined)).toBe(false);
  });
});

describe("appendTurnToHistory", () => {
  const user = { role: "user" as const, content: "draft the scene" };
  const assistant = { role: "assistant" as const, content: "prose here" };
  const prior = [
    { role: "user" as const, content: "u1" },
    { role: "assistant" as const, content: "a1" },
  ];

  it("inserts the hidden materials message just before the user turn", () => {
    const out = appendTurnToHistory(prior, user, "ATTACHED CONTEXT: profile text", assistant);
    expect(out.map(m => m.content)).toEqual([
      "u1", "a1", "ATTACHED CONTEXT: profile text", "draft the scene", "prose here",
    ]);
    // The materials ride as a hidden USER message -- in the history the model
    // sees, invisible in the transcript the writer sees.
    expect(out[2].hidden).toBe(true);
    expect(out[2].role).toBe("user");
    // The visible turns are NOT hidden.
    expect(out[3].hidden).toBeUndefined();
    expect(out[4].hidden).toBeUndefined();
  });

  it("appends only user + assistant when there are no new materials", () => {
    for (const materials of [null, undefined, ""]) {
      const out = appendTurnToHistory(prior, user, materials, assistant);
      expect(out.map(m => m.content)).toEqual(["u1", "a1", "draft the scene", "prose here"]);
    }
  });

  it("does not mutate the input history (pure function)", () => {
    const snapshot = [...prior];
    appendTurnToHistory(prior, user, "materials", assistant);
    expect(prior).toEqual(snapshot);
  });

  it("works on an empty history (first turn of a session)", () => {
    const out = appendTurnToHistory([], user, "materials", assistant);
    expect(out.map(m => m.content)).toEqual(["materials", "draft the scene", "prose here"]);
    expect(out[0].hidden).toBe(true);
  });
});
