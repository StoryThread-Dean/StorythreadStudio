// features/codex/lexicon.test.ts
// ===============================
// The Weave introduces a vocabulary -- Threads, Ties, Runs, Snags, Loose
// threads. Invented words earn their keep only if the app teaches them, and
// it can only teach them consistently if one file says what each one means.
//
// This is the fence around that file. A term that can appear on screen with
// no explanation behind it fails the build, because the alternative is a
// writer meeting the word "Snag" in a heading with nothing to click.

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TYPES,
  CONCEPTS,
  STOP_KINDS,
  TONE_CLASSES,
  lex,
  threadTypeEntry,
} from "./lexicon";

const ALL = [...Object.values(CONCEPTS), ...Object.values(STOP_KINDS)];


describe("every term explains itself", () => {
  it("has a name, an icon and a colour", () => {
    for (const term of ALL) {
      expect(term.term.trim()).not.toBe("");
      expect(term.code.trim()).not.toBe("");
      expect(term.Icon).toBeTruthy();
      expect(TONE_CLASSES[term.tone]).toBeTruthy();
    }
  });

  it("says what it is in one line, and what it DOES for the writer", () => {
    for (const term of ALL) {
      expect(term.short.length).toBeGreaterThan(10);
      expect(term.does.length).toBeGreaterThan(10);
    }
  });

  it("says more behind 'What's this?' than the one line already showed", () => {
    // A disclosure that repeats the tooltip is a disclosure nobody opens twice.
    for (const term of ALL) {
      expect(term.whatsThis.length).toBeGreaterThan(term.short.length * 2);
    }
  });

  it("writes in plain sentences, not labels", () => {
    for (const term of ALL) {
      expect(term.short.trim().endsWith(".")).toBe(true);
      expect(term.does.trim().endsWith(".")).toBe(true);
    }
  });
});


describe("the house punctuation rule", () => {
  it("uses no em or en dashes anywhere", () => {
    // The locked product rule: -- is the approved substitute. It applies to
    // canned copy as much as to model output.
    for (const term of ALL) {
      const text = `${term.term} ${term.short} ${term.does} ${term.whatsThis}`;
      expect(text).not.toMatch(/[—–]/);
    }
  });
});


describe("the words Weaving will use", () => {
  it("covers every kind of thing the walkthrough can find", () => {
    // Defined before the walkthrough ships, so the vocabulary is decided in
    // one pass rather than invented twice.
    const kinds = [
      "missing-entity", "thin-entity", "unlinked", "undated-fact",
      "unasked-rule", "contradiction", "contradiction-cluster", "orphan",
    ];
    for (const kind of kinds) {
      expect(STOP_KINDS[kind], `no entry for ${kind}`).toBeTruthy();
    }
  });

  it("gives each of them the writer-facing name, not the code", () => {
    expect(STOP_KINDS["orphan"].term).toBe("Loose thread");
    expect(STOP_KINDS["contradiction"].term).toBe("Snag");
    expect(STOP_KINDS["missing-entity"].term).toBe("Unspun");
  });
});


describe("kinds of Thread", () => {
  it("covers all nine built-in types", () => {
    expect(BUILT_IN_TYPES).toHaveLength(9);
    for (const type of BUILT_IN_TYPES) {
      const entry = threadTypeEntry(type);
      expect(entry.Icon).toBeTruthy();
      expect(entry.short.trim()).not.toBe("");
    }
  });

  it("gives a writer's own custom type an icon and a name too", () => {
    // Rendering a blank because we have never heard of it would punish them
    // for using a feature we built.
    const entry = threadTypeEntry("spaceship", "Spaceship");
    expect(entry.term).toBe("Spaceship");
    expect(entry.Icon).toBeTruthy();
    expect(entry.whatsThis.length).toBeGreaterThan(20);
  });

  it("falls back to the id when no label is given", () => {
    expect(threadTypeEntry("star_system").term).toBe("star system");
  });
});


describe("looking a term up", () => {
  it("finds concepts and stop kinds in one namespace", () => {
    // The UI does not care which list a word came from.
    expect(lex("codex")?.term).toBe("the Weave");
    expect(lex("orphan")?.term).toBe("Loose thread");
  });

  it("returns nothing for a word it does not know", () => {
    expect(lex("nonsense")).toBeUndefined();
  });
});
