// test-setup.ts -- Global setup that runs before every test file
// ==============================================================
// Listed in vite.config.ts > test.setupFiles, so vitest loads it
// automatically before any test suite.
//
// @testing-library/react cleans up the DOM between tests automatically
// (via its own afterEach). No extra teardown needed here for most cases.

import "@testing-library/react";


// ── Enough layout for CodeMirror to mount ───────────────────────────────────
//
// jsdom has no layout engine, so Range implements neither getClientRects nor
// getBoundingClientRect. CodeMirror calls both while measuring text, from an
// async measure pass it schedules after mounting.
//
// WHAT THAT LOOKS LIKE WHEN IT IS MISSING, because it is genuinely confusing:
// every assertion in the file passes, and vitest then exits NON-ZERO reporting
// unhandled errors, because the throw happens on the measure tick rather than
// inside any test. The summary line says "1632 passed" and the run has failed.
// It hid for several commits because the exit code was being read through a
// pipe into grep, which replaces it with grep's own.
//
// The rects returned here are fabricated but non-degenerate. Zero-width was
// tried first and is worse than useless: CodeMirror divides by the measured
// character width, so a zero produces Infinity and NaN geometry rather than an
// honest failure. Nothing in this repo asserts on rendered geometry -- jsdom
// could not support that anyway -- so the numbers only have to be sane.
if (typeof Range !== "undefined") {
  const rect = (): DOMRect => ({
    x: 0, y: 0, top: 0, left: 0, right: 8, bottom: 16,
    width: 8, height: 16,
    toJSON: () => ({}),
  }) as DOMRect;

  Range.prototype.getBoundingClientRect = rect;
  Range.prototype.getClientRects = function getClientRects(): DOMRectList {
    const list = [rect()] as DOMRect[] & {
      item(index: number): DOMRect | null;
    };
    list.item = (index: number) => list[index] ?? null;
    return list as unknown as DOMRectList;
  };
}
