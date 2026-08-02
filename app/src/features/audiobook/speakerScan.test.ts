// speakerScan.test.ts
// ====================
// Finding dialogue locally. This exists because the first build asked an
// AI where the dialogue was, which made a feature that cannot start
// without a network call, cannot be cancelled, and hung for fifteen
// minutes on one chapter. Quotation marks need no intelligence.
//
// The heuristic's job is to be RIGHT ABOUT LOCATION and merely helpful
// about names: a wrong location wraps the wrong words, a wrong name is
// one click to fix.

import { describe, it, expect } from "vitest";

import { mergeAiGuesses, scanSpeakers } from "./speakerScan";

describe("scanSpeakers", () => {
  it("finds quoted dialogue in reading order", () => {
    const text = 'He waited.\n\n"First line."\n\nShe left.\n\n"Second line."';
    const stops = scanSpeakers(text);
    expect(stops.map(s => s.quote)).toEqual(['"First line."', '"Second line."']);
    expect(text.slice(stops[0].start, stops[0].end)).toBe('"First line."');
  });

  it("reads the speaker out of a dialogue tag after the line", () => {
    const stops = scanSpeakers('"This cannot continue," Elena said.');
    expect(stops[0].guess).toBe("Elena");
    expect(stops[0].guessSource).toBe("tag");
  });

  it("reads a tag written the other way round", () => {
    const stops = scanSpeakers('"It already has," replied Marcus.');
    expect(stops[0].guess).toBe("Marcus");
  });

  it("reads a tag that comes before the line", () => {
    const stops = scanSpeakers('Elena said, "This cannot continue."');
    expect(stops[0].guess).toBe("Elena");
  });

  it("keeps a two-word name whole", () => {
    const stops = scanSpeakers('"Enough," Elena Vasquez said.');
    expect(stops[0].guess).toBe("Elena Vasquez");
  });

  it("does not mistake a pronoun or article for a name", () => {
    // "he said" is the commonest tag in fiction and names nobody. A
    // scanner that offered "He" as a cast member would be worse than
    // one that offered nothing.
    expect(scanSpeakers('"Enough," he said.')[0].guess).toBe("");
    expect(scanSpeakers('"Enough," the man said.')[0].guess).toBe("");
    expect(scanSpeakers('"Enough," they said.')[0].guess).toBe("");
  });

  it("does not let one paragraph's tag claim the next line", () => {
    // The worst version of a wrong guess: in an alternating exchange,
    // a tag that leaks across the paragraph break gives every second
    // line the wrong speaker -- confidently, and in the writer's own
    // vocabulary, so it reads as correct until you hear it.
    const text = '"This cannot continue," Elena said.\n\n"It already has."';
    const stops = scanSpeakers(text);
    expect(stops[0].guess).toBe("Elena");
    expect(stops[1].guess).toBe("");
  });

  it("leaves the name blank when there is no tag at all", () => {
    const stops = scanSpeakers('"Enough." The door closed behind her.');
    expect(stops[0].guess).toBe("");
    expect(stops[0].guessSource).toBe("");
  });

  it("skips lines the writer has already assigned", () => {
    // Re-asking about answered lines is what makes a walk feel endless.
    const text = '[voice:Elena]"Enough," she said.[/voice]\n\n"And this one?"';
    const stops = scanSpeakers(text);
    expect(stops.map(s => s.quote)).toEqual(['"And this one?"']);
  });

  it("handles curly quotes, which is what a pasted manuscript has", () => {
    const stops = scanSpeakers('“This cannot continue,” Elena said.');
    expect(stops).toHaveLength(1);
    expect(stops[0].guess).toBe("Elena");
  });

  it("ignores a quotation too short to be a line of dialogue", () => {
    // Scare quotes around one word are not somebody speaking.
    expect(scanSpeakers('She called it "a" problem.')).toHaveLength(0);
  });
});

describe("mergeAiGuesses", () => {
  const stops = scanSpeakers('"Enough."\n\n"Not yet," Elena said.');

  it("fills in a name the prose did not give", () => {
    const merged = mergeAiGuesses(stops, [
      { quote: '"Enough."', speaker: "Marcus", confidence: 0.7 },
    ]);
    expect(merged[0].guess).toBe("Marcus");
    expect(merged[0].guessSource).toBe("ai");
  });

  it("never overrides a tag the writer actually wrote", () => {
    // The writer's own tag is evidence; the model's guess is a guess.
    const merged = mergeAiGuesses(stops, [
      { quote: '"Not yet,"', speaker: "Marcus", confidence: 0.99 },
    ]);
    const tagged = merged.find(s => s.quote.startsWith('"Not yet'))!;
    expect(tagged.guess).toBe("Elena");
    expect(tagged.guessSource).toBe("tag");
  });

  it("ignores a proposal that matches no line the scan found", () => {
    // The model may have an opinion about who speaks. It never gets one
    // about where the writer's words begin and end.
    const merged = mergeAiGuesses(stops, [
      { quote: '"A line nobody wrote."', speaker: "Ghost", confidence: 1 },
    ]);
    expect(merged.every(s => s.guess !== "Ghost")).toBe(true);
  });
});
