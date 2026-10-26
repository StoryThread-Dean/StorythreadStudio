// tieDeleteAnchor.test.ts -- every screen that removes a connection names the stage
// ==================================================================================
// Issue #31. `DELETE /api/codex/tie` reads a missing `at` as "every stage of
// this relationship" -- deliberately, for a writer who wants the whole thing
// gone. But every screen here removes ONE row, and three of them left `at` off
// (two always, one whenever the stage was undated), so removing a single stage
// removed its siblings too, silently.
//
// Read from SOURCE across this folder, so a screen added tomorrow that builds
// its own delete is held to the same rule. SnagFixer has no component tests
// at all, which is part of why this went unnoticed.

import { describe, it, expect } from "vitest";

const SOURCES = import.meta.glob("./*.tsx",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const BUILT_ELSEWHERE = "./RelationshipsSection.tsx";

/** Every DELETE aimed at /api/codex/tie, as the text from the URL to the
 *  `method: "DELETE"` that closes the call. */
function tieDeletes(): { file: string; call: string }[] {
  const found: { file: string; call: string }[] = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    if (file.includes(".test.")) continue;
    // Builds its query in a params object ABOVE the fetch, so the slice below
    // cannot see it. Its component tests assert the anchor on the wire.
    if (file === BUILT_ELSEWHERE) continue;
    let from = 0;
    for (;;) {
      const start = text.indexOf("/api/codex/tie?", from);
      if (start === -1) break;
      const end = text.indexOf('method: "DELETE"', start);
      // Only a DELETE that belongs to THIS call -- not one a hundred lines on.
      if (end !== -1 && end - start < 1200) {
        found.push({ file, call: text.slice(start, end) });
      }
      from = start + 1;
    }
  }
  return found;
}

describe("removing a connection removes one stage", () => {
  it("actually read the screens (an empty read would pass the rest)", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
    const files = tieDeletes().map(d => d.file);
    expect(files).toEqual(expect.arrayContaining(
      ["./TieEditor.tsx", "./SnagFixer.tsx"]));
  });

  it("always sends the stage's anchor, even when it is empty", () => {
    for (const { file, call } of tieDeletes()) {
      const sendsAt = /[&?]at=/.test(call) || /\bat:/.test(call)
                      || /params\.set\("at"/.test(call);
      expect(sendsAt, `${file} removes a connection without its stage`)
        .toBe(true);
      // The #31 shape: an anchor sent only when it is non-empty.
      expect(call, `${file} drops the anchor for an undated stage`)
        .not.toMatch(/if \([^)]*[aA]t\) params\.set\("at"/);
    }
  });
});
