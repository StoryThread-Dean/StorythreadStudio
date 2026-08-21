// typeScale.test.ts -- the Interface size setting has to keep working
// =====================================================================
// WHAT THIS IS DEFENDING.
//
// useUiScale sets font-size on <html>. That moves rem-based utilities --
// text-xs, text-sm, and the text-2xs / text-micro / text-mini steps added in
// App.css -- and it moves nothing else. A class written as `text-[11px]` is
// an absolute size and sits perfectly still at every one of the four scale
// steps.
//
// This app had 847 of those, against 1,044 rem-based ones. So roughly 45% of
// the interface ignored the writer's Interface size setting, and because the
// px sizes clustered at 10 and 11 pixels, the text that refused to grow was
// the smallest text on the screen. Nobody noticed, because the setting does
// visibly SOMETHING -- just not to half the app.
//
// Nothing in the type system stops `text-[11px]` being typed again, and
// nothing about the result looks wrong in a screenshot at the default scale.
// It only shows up if you change the setting and look carefully. So it needs
// a gate rather than a convention.
//
// The audiobook side is included on purpose. Its palette is deliberately
// separate; its TEXT SIZE is not, and a writer who needs larger type needs it
// everywhere.

import { describe, it, expect } from "vitest";

const SOURCES = import.meta.glob(["./**/*.tsx", "./**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Arbitrary-value font sizes in px: text-[11px], text-[10.5px], text-[9px]. */
const PX_FONT_SIZE = /text-\[\d+(?:\.\d+)?px\]/g;

describe("type scale -- no frozen pixel font sizes", () => {
  it("found the component sources at all", () => {
    // A glob that matches nothing would make the assertion below pass
    // forever while checking exactly zero files.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(150);
  });

  it("uses rem steps everywhere, so Interface size moves all text", () => {
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(SOURCES)) {
      // This file quotes the pattern it bans, and the ban is the point.
      if (path.endsWith("/typeScale.test.ts")) continue;

      const hits = source.match(PX_FONT_SIZE);
      if (hits) {
        const unique = [...new Set(hits)].sort().join(", ");
        offenders.push(`${path}: ${unique} (${hits.length})`);
      }
    }

    expect(
      offenders,
      "these render at a fixed pixel size and will not respond to the " +
        "Interface size setting. Use text-2xs (9px), text-micro (10px), " +
        "text-mini (11px), text-xs (12px) or text-sm -- all rem, all scale.",
    ).toEqual([]);
  });
});
