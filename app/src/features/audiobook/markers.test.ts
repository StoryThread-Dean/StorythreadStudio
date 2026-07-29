// markers.test.ts
// ================
// The [Remove] button's contract: markers vanish, the writer's words
// never do.

import { describe, it, expect } from "vitest";
import { paragraphBoundsAt, stripAudioMarkers } from "./markers";

describe("stripAudioMarkers", () => {
  it("removes standalone pause and break markers", () => {
    const text = "One.\n\n[pause:1.5]\n\nTwo.\n\n[scene-break]\n\nThree.\n\n[chapter-break]\n\nFour.";
    expect(stripAudioMarkers(text)).toBe("One.\n\nTwo.\n\nThree.\n\nFour.");
  });

  it("dissolves say markers back to the displayed word", () => {
    expect(stripAudioMarkers("She met [say:KAY-lith]Kaelith[/say] again."))
      .toBe("She met Kaelith again.");
  });

  it("dissolves exclude markers keeping the inner text", () => {
    expect(stripAudioMarkers("A.\n\n[exclude]### Act I[/exclude]\n\nB."))
      .toBe("A.\n\n### Act I\n\nB.");
  });

  it("cleans up orphaned halves from hand-edits", () => {
    const out = stripAudioMarkers("Broken [say:x]word without close and [/exclude] tail.");
    expect(out).not.toContain("[say");
    expect(out).not.toContain("[/exclude]");
    expect(out).toContain("word without close");
    expect(out).toContain("tail.");
  });

  it("never deletes prose", () => {
    const prose = "No markers here—just words, dashes -- and [brackets] that are not markers.";
    expect(stripAudioMarkers(prose)).toBe(prose);
  });
});

describe("paragraphBoundsAt", () => {
  const text = "First block.\n\n[pause:0.8]\n\nThird block.";

  it("finds the block containing the caret", () => {
    const pos = text.indexOf("[pause");
    const { start, end } = paragraphBoundsAt(text, pos + 3);
    expect(text.slice(start, end)).toBe("[pause:0.8]");
  });

  it("handles the first and last blocks", () => {
    expect(text.slice(0, paragraphBoundsAt(text, 3).end)).toBe("First block.");
    const last = paragraphBoundsAt(text, text.length - 2);
    expect(text.slice(last.start, last.end)).toBe("Third block.");
  });
});
