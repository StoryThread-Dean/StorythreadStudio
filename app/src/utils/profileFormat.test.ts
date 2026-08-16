// profileFormat.test.ts -- what a context chip actually sends
// =============================================================
// This file serialises a profile for AI, and it is one of TWO places that do
// (the other is render_thread_brief in the backend's context.py). Two
// serialisers of one idea is a standing hazard here: R2.12g found a secret
// arriving marked through this path and unmarked through the other, so the
// same trait was protected or exposed depending purely on how it had been
// sent, with nothing anywhere in a position to notice.
//
// The difference between the two paths is that the brief knows WHERE in the
// book the writer is and this does not. A chip is attached by hand, out of any
// chapter. So where the brief can drop a trait that is not true here, this can
// only say that it is not always true -- which is the half that stops a model
// merging two descriptions of a character who changed.

import { describe, it, expect } from "vitest";

import { formatProfileForAI, traitWindowLabel, TRAIT_WINDOW_MARK } from "./profileFormat";
import type { Profile } from "../types/profile";

const CHAPTERS = [
  { anchor: "c-1" }, { anchor: "c-2" }, { anchor: "c-3" }, { anchor: "c-4" },
];

function profileWith(blocks: Profile["sections"][string]["trait_blocks"]): Profile {
  return {
    entity_id: "e-serena", type: "character", name: "Serena", role: "protagonist",
    sex: "", age: "", status: "active", tags: [], filename: "serena.md",
    full_ai_summary: "", created_at: "", updated_at: "", character_kind: "main",
    sections: {
      physical_traits: { heading: "Physical Traits", content: "",
                         ai_summary: "", trait_blocks: blocks },
    },
  } as unknown as Profile;
}

const trait = (name: string, extra: Record<string, unknown> = {}) => ({
  id: name, trait: name, description: `${name}.`,
  importance: "present" as const, ...extra,
});


describe("traitWindowLabel", () => {
  it("names one chapter", () => {
    expect(traitWindowLabel(["c-1"], CHAPTERS)).toBe(`${TRAIT_WINDOW_MARK} CHAPTER 1`);
  });

  it("collapses a run, because that is what a transformation produces", () => {
    expect(traitWindowLabel(["c-2", "c-3", "c-4"], CHAPTERS))
      .toBe(`${TRAIT_WINDOW_MARK} CHAPTERS 2-4`);
  });

  it("keeps a gap as a gap", () => {
    expect(traitWindowLabel(["c-1", "c-3"], CHAPTERS))
      .toBe(`${TRAIT_WINDOW_MARK} CHAPTERS 1, 3`);
  });

  it("still says LIMITED when it cannot say where", () => {
    // No chapter list, or a chapter since deleted. "Not always true" is the
    // load-bearing half: a model that knows two descriptions are alternatives
    // will write around them, one that thinks both are current merges them.
    expect(traitWindowLabel(["c-1"])).toBe(`${TRAIT_WINDOW_MARK} SOME CHAPTERS`);
    expect(traitWindowLabel(["c-gone"], CHAPTERS))
      .toBe(`${TRAIT_WINDOW_MARK} SOME CHAPTERS`);
  });
});


describe("what goes on a trait line", () => {
  it("an ordinary trait carries its weight and nothing else", () => {
    // The default must stay exactly what it has always been, or every existing
    // profile starts sending noise.
    const text = formatProfileForAI(profileWith([trait("stubborn")]), undefined, CHAPTERS);
    expect(text).toContain("- stubborn [present]: stubborn.");
  });

  it("MARKS BOTH SERENAS rather than sending them as equals", () => {
    const text = formatProfileForAI(profileWith([
      trait("slight", { true_in: ["c-1"] }),
      trait("powerfully built", { true_in: ["c-2", "c-3", "c-4"] }),
    ]), undefined, CHAPTERS);
    expect(text).toContain(`- slight [present, ${TRAIT_WINDOW_MARK} CHAPTER 1]`);
    expect(text).toContain(
      `- powerfully built [present, ${TRAIT_WINDOW_MARK} CHAPTERS 2-4]`);
  });

  it("keeps the secret marker, and puts it before the window", () => {
    // Order matters only in that it must be stable: ai/prompts.py describes
    // `[core, SUBTEXT]` and `[present, ONLY IN chapter 1]` in that shape.
    const text = formatProfileForAI(profileWith([
      trait("avoids hospitals", { subtext: true, true_in: ["c-1"] }),
    ]), undefined, CHAPTERS);
    expect(text).toContain(
      `- avoids hospitals [present, SUBTEXT, ${TRAIT_WINDOW_MARK} CHAPTER 1]`);
  });

  it("LEAVES OUT a trait that is true nowhere", () => {
    // Switched off everywhere. Sending it with a label telling the model to
    // disregard it costs tokens to say nothing, and the backend's brief drops
    // it at every anchor -- the two paths agree.
    const text = formatProfileForAI(profileWith([
      trait("shelved", { true_in: [] }),
      trait("stubborn"),
    ]), undefined, CHAPTERS);
    expect(text).not.toContain("shelved");
    expect(text).toContain("stubborn");
  });
});
