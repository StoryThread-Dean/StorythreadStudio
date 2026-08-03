// insertScan.test.ts
// ===================
// The walkthrough scanner's contract, pinned with the user's real
// examples: the Ruins-to-Relics burst, the [pace:=2] and unclosed
// [pause:0.4 typos from the live manuscript, and the
// narration-to-dialogue hand-offs the engine rushes through.

import { describe, it, expect } from "vitest";

import { applyStop, bulkApplyDefaults, scanForStops } from "./insertScan";
import type { InsertStop } from "./insertScan";

function kindsAt(text: string): Array<[string, number]> {
  return scanForStops(text).map(s => [s.kind, s.offset]);
}

describe("scanForStops", () => {
  it("finds the short-sentence burst from the live example", () => {
    const text = "From Ruins to Relics. I read it. The Cambodia chapter. "
      + "My god! That tomb door.";
    const stops = scanForStops(text);
    // Boundaries between the clipped sentences, plus the interjection.
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(stops.some(s => s.kind === "interjection"
      && s.title.includes("My god!"))).toBe(true);
    // Every stop offset sits right after a sentence-ending punctuation.
    for (const stop of stops) {
      expect([".", "!", "?"]).toContain(text[stop.offset - 1]);
    }
  });

  it("flags narration-to-dialogue and dialogue-to-narration hand-offs", () => {
    const text = 'She made a decision. "A cult." Lexa nodded slowly.';
    const kinds = kindsAt(text).map(([k]) => k);
    expect(kinds).toContain("dialogue-open");
    expect(kinds).toContain("dialogue-close");
  });

  it("flags a dialogue paragraph following narration", () => {
    const text = 'The room went quiet.\n\n"Who are you?"';
    const stops = scanForStops(text);
    const open = stops.find(s => s.kind === "dialogue-open");
    expect(open).toBeTruthy();
    // The pause lands at the END of the narration paragraph.
    expect(open!.offset).toBe(text.indexOf("\n\n"));
    // Paragraph hand-offs default to the longer beat.
    expect(open!.options[0].text).toBe("[pause:0.8]");
  });

  it("never suggests where the writer already placed a pause", () => {
    const text = 'She made a decision. [pause:0.8] "A cult."';
    const stops = scanForStops(text);
    expect(stops.filter(s => s.kind === "dialogue-open")).toEqual([]);
  });

  it("skips chapter headings and text inside markers", () => {
    const text = "# Chapter 1. The Door!\n\nProse continues here.";
    expect(scanForStops(text)).toEqual([]);
  });

  it("repairs the live [pace:=2] typo with signed-step fixes", () => {
    const text = 'Why out loud. [pace:=2]"That is how I recognized you."';
    const broken = scanForStops(text).find(s => s.kind === "broken-marker");
    expect(broken).toBeTruthy();
    expect(broken!.title).toContain("=2");
    expect(broken!.options.map(o => o.text)).toEqual(
      ["[pace:+2]", "[pace:-2]", ""]);
    expect(broken!.length).toBe("[pace:=2]".length);
  });

  it("repairs the live unclosed [pause:0.4 typo by closing the bracket", () => {
    const text = "Yes, [pause:0.4 Lexa. [pause:0.4] Or just Langford.";
    const broken = scanForStops(text).filter(s => s.kind === "broken-marker");
    expect(broken.length).toBe(1);
    expect(broken[0].options[0].text).toBe("]");
    expect(text.slice(broken[0].offset - 3, broken[0].offset)).toBe("0.4");
  });

  it("flags an unreadable pause duration", () => {
    const text = "Wait here. [pause:soon] She left.";
    const broken = scanForStops(text).find(s => s.kind === "broken-marker");
    expect(broken).toBeTruthy();
    expect(broken!.options[0].text).toBe("[pause:0.4]");
  });

  it("accepts valid pace forms without complaint", () => {
    const text = "[pace:-2]Slow.[/pace] [pace:+3]Fast.[/pace] [pace:0.8]Old.[/pace]";
    expect(scanForStops(text).filter(s => s.kind === "broken-marker")).toEqual([]);
  });

  it("honors the from offset and keeps stops ordered", () => {
    const text = 'One beat. Two beat. "Hello." She waved. Red door. Blue key.';
    const all = scanForStops(text);
    const later = scanForStops(text, 30);
    expect(later.every(s => s.offset >= 30)).toBe(true);
    expect(later.length).toBeLessThan(all.length);
    const offsets = all.map(s => s.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});

describe("applyStop", () => {
  const stop = (offset: number, length = 0): InsertStop => ({
    offset, length, kind: "short-burst", title: "", detail: "",
    options: [{ label: "Pause 0.4s", text: "[pause:0.4]" }],
  });

  it("inserts with smart spacing, never blank lines", () => {
    const text = "I read it. The Cambodia chapter.";
    const at = text.indexOf(".") + 1;
    const { next, caret } = applyStop(text, stop(at), {
      label: "Pause 0.4s", text: "[pause:0.4]" });
    expect(next).toBe("I read it. [pause:0.4] The Cambodia chapter.");
    expect(next[caret - 1]).toBe("]");
  });

  it("replaces a broken marker in place", () => {
    const text = 'A [pace:=2]"B."';
    const broken = scanForStops(text).find(s => s.kind === "broken-marker")!;
    const { next } = applyStop(text, broken, broken.options[0]);
    expect(next).toBe('A [pace:+2]"B."');
  });

  it("removing a marker swallows the doubled space", () => {
    const text = "Wait. [pause:soon] She left.";
    const broken = scanForStops(text).find(s => s.kind === "broken-marker")!;
    const remove = broken.options.find(o => o.text === "")!;
    const { next } = applyStop(text, broken, remove);
    expect(next).toBe("Wait. She left.");
  });

  it("reports the offset delta so later stops can shift", () => {
    const text = "A. B. C. D.";
    const { delta } = applyStop(text, stop(2), {
      label: "Pause 0.4s", text: "[pause:0.4]" });
    expect(delta).toBe(" [pause:0.4]".length);
  });
});

describe("bulkApplyDefaults", () => {
  it("applies every default beat in one pass, offsets shifting correctly", () => {
    const text = 'She decided. "A cult." Lexa nodded. Red door. Blue key.';
    const stops = scanForStops(text);
    const { next, applied, skippedRepairs } = bulkApplyDefaults(text, stops);
    expect(applied).toBe(stops.length);
    expect(skippedRepairs).toBe(0);
    // Each insert landed at its own spot despite the text growing.
    expect(next).toContain('She decided. [pause:0.4] "A cult."');
    expect(next).toContain('"A cult." [pause:0.4] Lexa nodded.');
    // The result parses clean: rescanning suggests nothing new (every
    // spot now has its pause) except nothing at all.
    expect(scanForStops(next).filter(s => s.kind !== "broken-marker")).toEqual([]);
  });

  it("never auto-fixes marker repairs -- those need the writer's call", () => {
    const text = 'Wait. Go. [pace:=2]"Run!"[/pace]';
    const stops = scanForStops(text);
    const { next, skippedRepairs } = bulkApplyDefaults(text, stops);
    expect(skippedRepairs).toBe(1);
    expect(next).toContain("[pace:=2]");           // untouched
    expect(next).toContain("Wait. [pause:0.4] Go.");
  });
});
