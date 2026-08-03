// insertScan.test.ts
// ===================
// The walkthrough scanner's contract, pinned with the user's real
// examples: the Ruins-to-Relics burst, the [pace:=2] and unclosed
// [pause:0.4 typos from the live manuscript, and the
// narration-to-dialogue hand-offs the engine rushes through.

import { describe, it, expect } from "vitest";

import {
  applyStop, bulkApplyDefaults, isBeatKind, scanForStops, sentenceAround,
} from "./insertScan";
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
    // Every BEAT stop sits right after a sentence-ending punctuation.
    // Word-reading stops are the other axis -- they target a word in the
    // middle of a sentence ("I read it" is in this very example), so they
    // are deliberately not bound by this.
    for (const stop of stops.filter(s => isBeatKind(s.kind))) {
      expect([".", "!", "?"]).toContain(text[stop.offset - 1]);
    }
  });

  it("flags narration-to-dialogue and dialogue-to-narration hand-offs", () => {
    const text = 'She made a decision. "A cult." Lexa nodded slowly.';
    const kinds = kindsAt(text).map(([k]) => k);
    expect(kinds).toContain("dialogue-open");
    expect(kinds).toContain("dialogue-close");
  });

  it("leaves a dialogue paragraph alone -- the paragraph gap covers it", () => {
    // This used to be offered as a stop. It no longer is: paragraph_gap_ms
    // (550ms by default) puts a real beat at every paragraph boundary, so
    // suggesting one here asked the writer to hand-place a pause the
    // pipeline already inserts.
    const text = 'The room went quiet.\n\n"Who are you?"';
    expect(scanForStops(text).filter(s => s.kind === "dialogue-open")).toEqual([]);
  });

  it("still flags a hand-off INSIDE a paragraph, which nothing else covers", () => {
    // Dialogue is detected per paragraph in the segmenter, so a quote that
    // opens mid-paragraph gets no seam from any setting. This is the one
    // dialogue case the walk still has to offer.
    const text = 'The woman\'s jaw tightened. "I don\'t have time."';
    const open = scanForStops(text).find(s => s.kind === "dialogue-open");
    expect(open).toBeTruthy();
    expect(open!.offset).toBe(text.indexOf(".") + 1);
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

  it("never auto-picks a word reading -- that is a meaning, not a beat", () => {
    // Auto-apply is a convenience for pacing. Choosing between "reed" and
    // "red" is choosing what the sentence says, and getting it wrong puts
    // a mispronunciation in the finished book under the writer's name.
    const text = "I read it yesterday. Then I burned it. No trace left.";
    const stops = scanForStops(text);
    expect(stops.some(s => s.kind === "heteronym")).toBe(true);
    const { next } = bulkApplyDefaults(text, stops);
    expect(next).not.toContain("[say:");
    expect(next).toContain("[pause:");             // the beat still landed
  });
});

describe("scanForStops short bursts", () => {
  it("keeps the live example's rhythm -- a beat at every boundary in the run", () => {
    const text = "From Ruins to Relics. I read it. The Cambodia chapter. "
      + "My god! That tomb door.";
    const beats = scanForStops(text).filter(s => isBeatKind(s.kind));
    // Five clipped sentences, so four internal boundaries (the last
    // sentence has no boundary after it inside the line). Three come
    // through as bursts; the boundary after "My god!" is claimed by the
    // interjection rule instead, which is the more specific explanation
    // for the same beat.
    expect(beats).toHaveLength(4);
    expect(beats.filter(s => s.kind === "short-burst")).toHaveLength(3);
    expect(beats.filter(s => s.kind === "interjection")).toHaveLength(1);
    expect(text.slice(beats[0].offset - 7, beats[0].offset)).toBe("Relics.");
  });

  it("leaves a lone pair of short sentences alone", () => {
    // Measured against a real chapter: this is what ordinary prose looks
    // like, and firing on it produced one stop every 56 words.
    const text = "Not that I am judging. I have thrown a book before, once, "
      + "in a mood I am not proud of and would rather not discuss.";
    expect(scanForStops(text).filter(s => s.kind === "short-burst")).toEqual([]);
  });

  it("does not count ordinary mid-length sentences as clipped", () => {
    const text = "I don't know their names. I don't know where they were "
      + "based. I just know what they wanted from the people who knelt.";
    expect(scanForStops(text).filter(s => s.kind === "short-burst")).toEqual([]);
  });

  it("measures a sentence by what is SPOKEN, not by its markers", () => {
    // A clipped line carrying a [say] override is still clipped. Counting
    // the marker's characters would push it over the limit and lose its
    // beat -- exactly backwards, since a worked chapter has the most
    // markers and needs the walk least wrong.
    const text = "Ruins to Relics. I [say:red]read[/say] it. Cambodia now. "
      + "My god! The door.";
    expect(scanForStops(text).filter(s => s.kind === "short-burst").length)
      .toBeGreaterThanOrEqual(3);
  });

  it("never lets a beat swallow a marker repair", () => {
    // Different axes: a repair is not optional, and a beat landing a
    // character away from it must not collapse it as a near-duplicate.
    const text = 'Wait. Go. Now. [pace:=2]"Run!"[/pace]';
    const kinds = scanForStops(text).map(s => s.kind);
    expect(kinds).toContain("broken-marker");
    expect(kinds).toContain("short-burst");
  });

  it("does not run a burst across a paragraph break", () => {
    // Two clipped sentences ending one paragraph plus one opening the next
    // is not a rhythm -- and the paragraph gap already sits between them.
    const text = "He waited. She left.\n\nThe door shut.";
    expect(scanForStops(text).filter(s => s.kind === "short-burst")).toEqual([]);
  });
});

// ── Word readings (spec 18.6) ─────────────────────────────────────────────────

describe("scanForStops word readings", () => {
  it("stops on a heteronym and offers only the readings needing a marker", () => {
    const stops = scanForStops("She wound the cord around her hand.");
    const stop = stops.find(s => s.kind === "heteronym");
    expect(stop).toBeTruthy();
    expect(stop!.word).toBe("wound");
    expect(stop!.length).toBe("wound".length);
    // Both readings travel with the stop so each can get a Play button...
    expect(stop!.readings).toHaveLength(2);
    // ...but only the one the engine does NOT already produce is applicable.
    expect(stop!.options).toHaveLength(1);
    expect(stop!.options[0].text).toBe("[say:wow-nd]wound[/say]");
  });

  it("keeps the writer's own capitalization when it wraps", () => {
    // "Read the letter" at the start of a sentence must not come back as
    // lowercase in the manuscript -- the marker is invisible to the
    // reader, the word beside it is not.
    const stops = scanForStops("Read it again, she said.");
    const stop = stops.find(s => s.kind === "heteronym");
    expect(stop!.word).toBe("Read");
    expect(stop!.options[0].text).toBe("[say:red]Read[/say]");
  });

  it("matches whole words only", () => {
    // "already", "bread", "closet", "windows" all contain a heteronym as a
    // substring. Stopping on those would be noise the writer learns to
    // ignore, which costs the real stops their credibility.
    const stops = scanForStops(
      "He already ate bread from the closet by the windows.");
    expect(stops.filter(s => s.kind === "heteronym")).toEqual([]);
  });

  it("skips a word the writer already wrapped in a say override", () => {
    const stops = scanForStops("Yesterday I [say:red]read[/say] the letter.");
    expect(stops.filter(s => s.kind === "heteronym")).toEqual([]);
  });

  it("still asks about a word standing beside a pause the writer chose", () => {
    // A pause says nothing about which reading was meant. The
    // nearby-pause suppression belongs to the beat axis only, and letting
    // it swallow a reading question would hide the stop for good.
    const stops = scanForStops("She stopped. [pause:0.8] I read it yesterday.");
    expect(stops.some(s => s.kind === "heteronym")).toBe(true);
  });

  it("keeps a beat and a reading question that land on the same spot", () => {
    // Different axes, both can be right. Collapsing them as duplicates
    // would silently drop one of the two.
    const text = "She waited. Read it now. He would not.";
    const stops = scanForStops(text);
    const at = text.indexOf("Read");
    expect(stops.filter(s => Math.abs(s.offset - at) <= 1).length)
      .toBeGreaterThanOrEqual(2);
  });

  it("does not stop on a heteronym inside a chapter heading", () => {
    expect(scanForStops("# The Lead Casket\n\nProse follows.")).toEqual([]);
  });
});

describe("sentenceAround", () => {
  it("returns the sentence holding the word, for a clip that sounds like the book", () => {
    const text = "He waited. She wound the cord tight. Then he left.";
    const { start, end } = sentenceAround(text, text.indexOf("wound"));
    expect(text.slice(start, end)).toBe("She wound the cord tight.");
  });

  it("does not mistake a marker's decimal point for a sentence ending", () => {
    // The bug that pushed the say popout onto a fixed carrier phrase: the
    // "." in [pause:0.8] read as a full stop, and the clip came out as a
    // fragment that the engine slurs.
    const text = "She stopped [pause:0.8] and read it slowly to him.";
    const { start, end } = sentenceAround(text, text.indexOf("read"));
    expect(text.slice(start, end)).toBe(text);
  });

  it("stops at a paragraph break rather than running into the next scene", () => {
    const text = "First paragraph ends here\n\nShe read it again";
    const { start, end } = sentenceAround(text, text.indexOf("read"));
    expect(text.slice(start, end)).toBe("She read it again");
  });

  it("keeps a closing quote with the sentence it ends", () => {
    const text = 'He said, "I read it." She nodded.';
    const { start, end } = sentenceAround(text, text.indexOf("read"));
    expect(text.slice(start, end)).toBe('He said, "I read it."');
  });
});
