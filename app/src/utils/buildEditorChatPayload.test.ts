// buildEditorChatPayload.test.ts
// ==============================
// Unit tests for the pure helper that decides what materials a Writing
// Companion turn sends. Covers the three scenarios that matter for the new
// Draft mode + Continue feature:
//   - typed message, Draft mode OFF  -> category "chat"
//   - typed message, Draft mode ON   -> category "draft"
//   - Continue turn                  -> category "draft", no text, only new chips

import { describe, it, expect } from "vitest";
import { buildEditorChatPayload, isWeakDraftingModel } from "./buildEditorChatPayload";
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
