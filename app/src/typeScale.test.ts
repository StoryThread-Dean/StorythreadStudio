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

// ---------------------------------------------------------------------------
// THE OTHER WAY TO FREEZE A FONT SIZE
// ---------------------------------------------------------------------------
// The gate above catches `text-[11px]` in a Tailwind class. It cannot see a
// size set in JavaScript, and that is exactly where the worst instance of this
// bug spent the app's entire life:
//
//     // MarkdownEditor.tsx, buildFontTheme
//     "&": { fontSize: "16px" }
//
// An absolute pixel size in a CodeMirror theme object. useUiScale moves rem
// utilities by setting font-size on <html>; nothing it does can reach a px
// literal inside a JS object. So the writer's own prose -- the manuscript, the
// outline, notes and both summary editors -- rendered at exactly 16px at every
// Interface size step, while 1,044 rem-based chrome utilities moved around it.
//
// It went unnoticed for the same reason the line-height bug did: 16px is a
// perfectly plausible size, so nothing looked broken. It surfaced only when a
// writer on a 4K display said the maximum font size was "way too small".
//
// Prose now comes from useEditorFontSize and chrome uses rem. This gate keeps
// both true. `em`, `rem` and `%` are all fine here -- they inherit, which is
// the whole point.

describe("type scale -- no frozen pixel sizes in style objects either", () => {
  /** `fontSize: "16px"` in any quote style. A template literal starts with
   *  `${` and is therefore computed, which is what we want people to write. */
  const JS_PX_FONT_SIZE = /fontSize:\s*["'`](\d+(?:\.\d+)?)px["'`]/g;

  /**
   * Comments are stripped first. Two files legitimately QUOTE the banned
   * pattern while explaining why it was banned -- useEditorFontSize.ts and its
   * test -- and excluding them by name would leave a hole in the gate. Reading
   * only real code closes it without an allowlist.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  }

  it("uses inheritable units in CodeMirror and overlay themes", () => {
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith("/typeScale.test.ts")) continue;   // quotes the pattern

      const hits = stripComments(source).match(JS_PX_FONT_SIZE);
      if (hits) {
        const unique = [...new Set(hits)].sort().join(", ");
        offenders.push(`${path}: ${unique} (${hits.length})`);
      }
    }

    expect(
      offenders,
      "a font size written as an absolute pixel string in a style object " +
        "cannot be moved by ANY setting -- not Interface size, not Editor text " +
        "size. For the writer's prose, take the value from useEditorFontSize. " +
        "For editor chrome (the Find panel, issue badges), use rem so it " +
        "follows Interface size like the rest of the chrome does.",
    ).toEqual([]);
  });
});
