// spellcheck.test.ts -- Dictionary-backed spell checking
// =======================================================
// Verifies the nspell + dictionary-en integration that powers the editor's
// right-click correction suggestions. These tests load the real bundled
// dictionary (via Vite's ?raw import), so they also prove the dictionary
// data is reachable in a Vite build -- the exact mechanism the app uses.

import { describe, it, expect } from "vitest";
import { isMisspelled, suggestCorrections } from "./spellcheck";

describe("isMisspelled", () => {
  it("returns true for a clear misspelling", () => {
    expect(isMisspelled("permanantly")).toBe(true);
    expect(isMisspelled("recieve")).toBe(true);
  });

  it("returns false for correctly spelled words", () => {
    expect(isMisspelled("permanently")).toBe(false);
    expect(isMisspelled("receive")).toBe(false);
    expect(isMisspelled("walk")).toBe(false);
  });

  it("ignores non-words (punctuation, numbers, empty)", () => {
    expect(isMisspelled("")).toBe(false);
    expect(isMisspelled("123")).toBe(false);
    expect(isMisspelled("...")).toBe(false);
  });

  it("respects the original case (capitalized real word is still correct)", () => {
    expect(isMisspelled("Walk")).toBe(false);
  });
});

describe("suggestCorrections", () => {
  it("suggests the correct spelling for a misspelling", () => {
    const suggestions = suggestCorrections("permanantly");
    expect(suggestions).toContain("permanently");
  });

  it("suggests 'receive' for 'recieve'", () => {
    expect(suggestCorrections("recieve")).toContain("receive");
  });

  it("caps the number of suggestions", () => {
    const suggestions = suggestCorrections("permanantly", 3);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty array for non-words", () => {
    expect(suggestCorrections("123")).toEqual([]);
    expect(suggestCorrections("")).toEqual([]);
  });
});
