// ProjectSettings.helpers.test.ts
// ================================
// The suggestion-picker comma-list helpers: clicking a checkbox chip must
// insert/remove its text from the field WITHOUT mangling anything the
// writer hand-typed alongside it.

import { describe, it, expect } from "vitest";
import { splitParts, hasPart, togglePart } from "./ProjectSettings";

describe("suggestion picker comma-list helpers", () => {
  it("splitParts trims and drops empties", () => {
    expect(splitParts("Fantasy,  Romantasy , ,")).toEqual(["Fantasy", "Romantasy"]);
    expect(splitParts("")).toEqual([]);
  });

  it("hasPart matches whole entries case-insensitively", () => {
    expect(hasPart("Fantasy, Sci-Fi Thriller", "sci-fi thriller")).toBe(true);
    // Substrings must NOT count -- "Fantasy" is not checked just because
    // "Epic Fantasy" is in the box.
    expect(hasPart("Epic Fantasy", "Fantasy")).toBe(false);
  });

  it("toggle adds when absent, appending after hand-typed entries", () => {
    expect(togglePart("", "Fantasy")).toBe("Fantasy");
    expect(togglePart("High Space Adventure", "Space Opera"))
      .toBe("High Space Adventure, Space Opera");
  });

  it("toggle removes when present, preserving everything else", () => {
    expect(togglePart("High Space Adventure, Space Opera, Dystopian", "Space Opera"))
      .toBe("High Space Adventure, Dystopian");
    // Case-insensitive removal of a hand-typed variant.
    expect(togglePart("epic fantasy, Dark", "Epic Fantasy")).toBe("Dark");
  });

  it("add-then-remove round-trips to the original list", () => {
    const start = "My Own Genre";
    const added = togglePart(start, "Cozy Mystery");
    expect(togglePart(added, "Cozy Mystery")).toBe(start);
  });
});
