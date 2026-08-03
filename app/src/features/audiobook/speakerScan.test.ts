// speakerScan.test.ts
// ====================
// The Cast workbench's scanner. All of it is plain string work, which is
// the point: finding dialogue needs no model, so the workbench opens
// instantly, costs nothing, and works offline. An earlier build asked an
// AI where the dialogue was and hung for fifteen minutes on one chapter.
//
// The unit is a PARAGRAPH. Two quotes by the same speaker in one
// paragraph is one decision, not two -- and assigning wraps the quoted
// runs only, so the dialogue tag stays with the narrator, which is how
// audiobooks are actually read.

import { describe, it, expect } from "vitest";

import {
  chapterCast, chapterRanges, countCharacterUsage, mergeAiGuesses,
  removeCharacterMarkers, scanDialogue, setStopVoice, stripVoiceSpans,
} from "./speakerScan";

const BOOK =
  "# Chapter One\n\n"
  + "The gate stood open.\n\n"
  + '"This cannot continue," Lara said.\n\n'
  + '"I heard a noise," Alexandra said. "I was just checking."\n\n'
  + "# Chapter Two\n\n"
  + '"Enough." The door closed behind her.\n';

function chapterOne() {
  return chapterRanges(BOOK)[0];
}

describe("chapterRanges", () => {
  it("splits on h1 headings and excludes the heading itself", () => {
    const ranges = chapterRanges(BOOK);
    expect(ranges.map(r => r.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(BOOK.slice(ranges[0].start, ranges[0].end)).toContain("The gate stood open.");
    expect(BOOK.slice(ranges[0].start, ranges[0].end)).not.toContain("# Chapter One");
  });

  it("treats a file with no headings as one chapter", () => {
    expect(chapterRanges('"Hello," she said.')).toHaveLength(1);
  });
});

describe("scanDialogue", () => {
  it("finds dialogue paragraphs, not quotations", () => {
    const stops = scanDialogue(BOOK, chapterOne());
    expect(stops).toHaveLength(2);
    // Two quotes by one speaker in one paragraph = ONE decision.
    expect(stops[1].quotes).toHaveLength(2);
  });

  it("offsets point at the real paragraph in the whole buffer", () => {
    const stops = scanDialogue(BOOK, chapterOne());
    expect(BOOK.slice(stops[0].start, stops[0].end)).toBe(stops[0].text);
  });

  it("reads the speaker from a dialogue tag, either way round", () => {
    expect(scanDialogue(BOOK, chapterOne())[0].guess).toBe("Lara");
    const stops = scanDialogue('"It has," replied Marcus.', {
      title: "x", start: 0, end: 24 });
    expect(stops[0].guess).toBe("Marcus");
  });

  it("does not offer a pronoun as a character", () => {
    // "he said" is the commonest tag in fiction and names nobody.
    const text = '"Enough," he said.';
    expect(scanDialogue(text, { title: "x", start: 0, end: text.length })[0].guess)
      .toBe("");
  });

  it("does not let one paragraph's tag claim the next", () => {
    // In an alternating exchange this would give every second line the
    // wrong speaker -- confidently, and in the writer's own vocabulary.
    const stops = scanDialogue(BOOK, chapterRanges(BOOK)[1]);
    expect(stops[0].guess).toBe("");
  });

  it("reports a paragraph that is already assigned", () => {
    const text = '[voice:Lara]"Enough."[/voice]';
    const stops = scanDialogue(text, { title: "x", start: 0, end: text.length });
    expect(stops[0].assigned).toBe("Lara");
    // The quote is still found, so the writer can reassign it.
    expect(stops[0].quotes).toHaveLength(1);
  });

  it("reads an action beat when there is no dialogue tag", () => {
    // Live finding: lines tagged "Lara said" were marked and lines
    // attributed by "Lara's voice was flat." were skipped. Fiction
    // attributes at least as often by beat as by tag, and a possessive
    // is the commonest form a beat takes.
    const text = `"This wasn't about fertility." Lara's voice was flat. `
      + `"This was about the act itself."`;
    const stops = scanDialogue(text, { title: "x", start: 0, end: text.length });
    expect(stops[0].guess).toBe("Lara");
    expect(stops[0].guessSource).toBe("beat");
  });

  it("reads a plain action beat too, not just a possessive", () => {
    const text = '"Enough." Alexandra set the book aside.';
    const stops = scanDialogue(text, { title: "x", start: 0, end: text.length });
    expect(stops[0].guess).toBe("Alexandra");
    expect(stops[0].guessSource).toBe("beat");
  });

  it("resolves a possessive nickname to the bare nickname", () => {
    const text = `"Not yet." Lexi's hand closed on the rail.`;
    expect(scanDialogue(text, { title: "x", start: 0, end: text.length })[0].guess)
      .toBe("Lexi");
  });

  it("refuses to guess when the paragraph names two people", () => {
    // A coin toss in the writer's own vocabulary reads as correct until
    // they hear it, which is the worst kind of wrong this app can be.
    const text = '"Enough." Lara looked at Alexandra.';
    expect(scanDialogue(text, { title: "x", start: 0, end: text.length })[0].guess)
      .toBe("");
  });

  it("a real dialogue tag still outranks the beat", () => {
    const text = '"Enough," Alexandra said. Lara looked away.';
    const stops = scanDialogue(text, { title: "x", start: 0, end: text.length });
    expect(stops[0].guess).toBe("Alexandra");
    expect(stops[0].guessSource).toBe("tag");
  });

  it("the AI never overrules a name the prose gave, tag or beat", () => {
    const text = `"Enough." Lara's voice was flat.`;
    const stops = scanDialogue(text, { title: "x", start: 0, end: text.length });
    const merged = mergeAiGuesses(stops, [
      { quote: '"Enough."', speaker: "Marcus", confidence: 0.99 }]);
    expect(merged[0].guess).toBe("Lara");
    expect(merged[0].guessSource).toBe("beat");
  });

  it("skips paragraphs with no dialogue at all", () => {
    const stops = scanDialogue(BOOK, chapterOne());
    expect(stops.every(s => !s.text.startsWith("The gate"))).toBe(true);
  });
});

describe("setStopVoice", () => {
  it("wraps every quoted run in the paragraph, leaving the tag to the narrator", () => {
    const stops = scanDialogue(BOOK, chapterOne());
    const next = setStopVoice(BOOK, stops[1], "Alexandra");
    expect(next).toContain('[voice:Alexandra]"I heard a noise,"[/voice] Alexandra said.');
    expect(next).toContain('[voice:Alexandra]"I was just checking."[/voice]');
    // "Alexandra said." is narration and must stay outside the span.
    expect(next).not.toContain('Alexandra said."[/voice]');
  });

  it("re-assigning replaces rather than nesting", () => {
    // Clicking through three characters in a row is normal. The last
    // click must simply be what the paragraph says.
    const first = setStopVoice(BOOK, scanDialogue(BOOK, chapterOne())[0], "Lara");
    const stops = scanDialogue(first, chapterRanges(first)[0]);
    const second = setStopVoice(first, stops[0], "Alexandra");
    expect(second).toContain('[voice:Alexandra]"This cannot continue,"[/voice]');
    expect(second).not.toContain("[voice:Lara]");
    expect(second.match(/\[voice:/g)).toHaveLength(1);
  });

  it("clearing puts the line back to the narrator without losing a word", () => {
    const assigned = setStopVoice(BOOK, scanDialogue(BOOK, chapterOne())[0], "Lara");
    const stops = scanDialogue(assigned, chapterRanges(assigned)[0]);
    const cleared = setStopVoice(assigned, stops[0], null);
    expect(cleared).toBe(BOOK);
  });

  it("never touches the rest of the book", () => {
    const next = setStopVoice(BOOK, scanDialogue(BOOK, chapterOne())[0], "Lara");
    expect(next).toContain("# Chapter Two");
    expect(next).toContain('"Enough." The door closed behind her.');
  });
});

describe("chapterCast", () => {
  it("names only the people this chapter uses", () => {
    // A thirty-character book has to show three buttons, and the AI must
    // not be offered names that are not in the scene.
    expect(chapterCast(BOOK, chapterOne()).sort()).toEqual(["Alexandra", "Lara"]);
    expect(chapterCast(BOOK, chapterRanges(BOOK)[1])).toEqual([]);
  });

  it("counts a marked speaker even when the prose never names them", () => {
    const text = '[voice:Innkeeper]"Room for one?"[/voice]';
    expect(chapterCast(text, { title: "x", start: 0, end: text.length }))
      .toEqual(["Innkeeper"]);
  });
});

describe("removing a character", () => {
  it("counts real usage across the book before anything is deleted", () => {
    let book = setStopVoice(BOOK, scanDialogue(BOOK, chapterOne())[0], "Lara");
    const second = scanDialogue(book, chapterRanges(book)[0])[1];
    book = setStopVoice(book, second, "Lara");
    const usage = countCharacterUsage(book, "lara");
    // Two paragraphs, three quoted runs between them.
    expect(usage.lines).toBe(3);
    expect(usage.chapters).toEqual(["Chapter One"]);
  });

  it("removes the markers everywhere and keeps every word", () => {
    const book = setStopVoice(BOOK, scanDialogue(BOOK, chapterOne())[0], "Lara");
    const cleaned = removeCharacterMarkers(book, "Lara");
    expect(cleaned).toBe(BOOK);
    expect(cleaned).toContain('"This cannot continue," Lara said.');
  });

  it("leaves other characters alone", () => {
    let book = setStopVoice(BOOK, scanDialogue(BOOK, chapterOne())[0], "Lara");
    const second = scanDialogue(book, chapterRanges(book)[0])[1];
    book = setStopVoice(book, second, "Alexandra");
    const cleaned = removeCharacterMarkers(book, "Lara");
    expect(cleaned).not.toContain("[voice:Lara]");
    expect(cleaned).toContain("[voice:Alexandra]");
  });
});

describe("stripVoiceSpans", () => {
  it("dissolves the wrapper and never the words", () => {
    expect(stripVoiceSpans('[voice:Lara]"Hello"[/voice] she said.'))
      .toBe('"Hello" she said.');
  });
});

describe("mergeAiGuesses", () => {
  it("fills in a name the prose did not give", () => {
    const stops = scanDialogue(BOOK, chapterRanges(BOOK)[1]);
    const merged = mergeAiGuesses(stops, [
      { quote: '"Enough."', speaker: "Marcus", confidence: 0.7 }]);
    expect(merged[0].guess).toBe("Marcus");
    expect(merged[0].guessSource).toBe("ai");
  });

  it("never overrides a tag the writer actually wrote", () => {
    const stops = scanDialogue(BOOK, chapterOne());
    const merged = mergeAiGuesses(stops, [
      { quote: '"This cannot continue,"', speaker: "Marcus", confidence: 0.99 }]);
    expect(merged[0].guess).toBe("Lara");
    expect(merged[0].guessSource).toBe("tag");
  });

  it("ignores a proposal matching no line the scan found", () => {
    const stops = scanDialogue(BOOK, chapterOne());
    const merged = mergeAiGuesses(stops, [
      { quote: '"A line nobody wrote."', speaker: "Ghost", confidence: 1 }]);
    expect(merged.every(s => s.guess !== "Ghost")).toBe(true);
  });
});
