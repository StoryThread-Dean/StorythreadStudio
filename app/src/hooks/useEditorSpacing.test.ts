// useEditorSpacing.test.ts -- what the named options actually do
// ==============================================================
// Line spacing is offered under word-processor names -- Single, 1.5 lines,
// Double, Multiple -- and those names are a PROMISE about proportions. A
// writer picking "Double" expects twice the space of Single, and picking
// "1.5 lines" expects half again. If the arithmetic drifts, nothing errors
// and nothing looks obviously wrong; the manuscript is just spaced wrongly
// under a label that says otherwise.
//
// The figures pinned below are the ones a word processor reports: Single
// around 116% of the font size, 1.5 lines at 175%, Double at 233%. They come
// out of SINGLE_BASIS, so this file is really testing that the basis and the
// steps still agree with the names on the buttons.

import { describe, it, expect } from "vitest";
import {
  SINGLE_BASIS,
  MULTIPLE_MIN,
  MULTIPLE_MAX,
  LINE_SPACING_OPTIONS,
  clampMultiple,
  resolveLineHeight,
  type LineSpacing,
} from "./useEditorSpacing";

describe("the named options keep word-processor proportions", () => {
  it("resolves each option to the line height a word processor reports", () => {
    expect(resolveLineHeight("single", 1)).toBe(1.17);
    expect(resolveLineHeight("one_half", 1)).toBe(1.75);
    expect(resolveLineHeight("double", 1)).toBe(2.33);
  });

  it("keeps 1.5 lines and Double as multiples of Single, not of 1.0", () => {
    // The whole reason SINGLE_BASIS exists. If Single were treated as a flat
    // 1.0, Double would come out at 2.00 and the label would be lying about
    // what it doubled.
    // Compared against the basis rather than against each other: both
    // returned values are already rounded to 2dp for display, so their ratio
    // carries that rounding and cannot be exactly 1.5 or 2.0.
    const r = (n: number) => Math.round(n * SINGLE_BASIS * 100) / 100;
    expect(resolveLineHeight("single", 1)).toBe(r(1.0));
    expect(resolveLineHeight("one_half", 1)).toBe(r(1.5));
    expect(resolveLineHeight("double", 1)).toBe(r(2.0));
    expect(resolveLineHeight("single", 1)).toBeGreaterThan(1.0);
  });

  it("puts Single in the 115-120% band Word measures from font metrics", () => {
    expect(SINGLE_BASIS).toBeGreaterThanOrEqual(1.15);
    expect(SINGLE_BASIS).toBeLessThanOrEqual(1.2);
  });

  it("defaults close enough to the editor's old 1.8 that nothing reflows", () => {
    // The editor was hardcoded at 1.8 for its whole life, and "one_half" is
    // the shipped default. If these ever diverge much, upgrading would
    // silently re-space every writer's manuscript.
    expect(Math.abs(resolveLineHeight("one_half", 1) - 1.8)).toBeLessThan(0.1);
  });

  it("offers exactly the four options, in the order a writer expects", () => {
    expect(LINE_SPACING_OPTIONS.map(o => o.id)).toEqual([
      "single", "one_half", "double", "multiple",
    ]);
    expect(LINE_SPACING_OPTIONS.map(o => o.label)).toEqual([
      "Single", "1.5 lines", "Double", "Multiple",
    ]);
  });

  it("rounds to two decimals, so the number shown IS the number applied", () => {
    // The Settings screen prints this with toFixed(2). If resolve returned
    // more precision than it displayed, the writer would be reading a
    // rounded version of something else.
    for (const id of ["single", "one_half", "double"] as LineSpacing[]) {
      const v = resolveLineHeight(id, 1);
      expect(Number(v.toFixed(2))).toBe(v);
    }
  });
});

describe("Multiple -- a custom multiplier, bounded", () => {
  it("scales the custom value by the same basis as the named options", () => {
    // Word's Multiple is "N single line heights", not "N em".
    expect(resolveLineHeight("multiple", 1.0)).toBe(resolveLineHeight("single", 1));
    expect(resolveLineHeight("multiple", 1.5)).toBe(resolveLineHeight("one_half", 1));
    expect(resolveLineHeight("multiple", 2.0)).toBe(resolveLineHeight("double", 1));
  });

  it("clamps to the usable range at both ends", () => {
    expect(clampMultiple(0.1)).toBe(MULTIPLE_MIN);
    expect(clampMultiple(-4)).toBe(MULTIPLE_MIN);
    expect(clampMultiple(99)).toBe(MULTIPLE_MAX);
    expect(clampMultiple(2.5)).toBe(2.5);
  });

  it("clamps inside resolve too, so a bad value can never reach the editor", () => {
    // Belt and braces: the Settings input clamps on blur, but resolve is
    // also called with the stored value at boot, which could be anything if
    // settings.json was hand-edited.
    expect(resolveLineHeight("multiple", 0)).toBe(
      resolveLineHeight("multiple", MULTIPLE_MIN),
    );
    expect(resolveLineHeight("multiple", 1000)).toBe(
      resolveLineHeight("multiple", MULTIPLE_MAX),
    );
  });

  it("falls back to single spacing rather than NaN on garbage", () => {
    // A NaN line-height would make CodeMirror render at the browser default
    // with no error anywhere -- the writer would just find their spacing
    // setting mysteriously ignored.
    expect(clampMultiple(NaN)).toBe(1.0);
    expect(clampMultiple(Infinity)).toBe(MULTIPLE_MAX);
    expect(Number.isFinite(resolveLineHeight("multiple", NaN))).toBe(true);
  });

  it("never lets lines collide", () => {
    // The floor is the point of the floor.
    expect(MULTIPLE_MIN).toBeGreaterThanOrEqual(0.8);
    expect(resolveLineHeight("multiple", MULTIPLE_MIN)).toBeGreaterThan(0.9);
  });
});

describe("the one control actually offers it", () => {
  // A source read, for the same reason Explain.test.tsx reads screens rather
  // than rendering them: mounting the whole Settings modal needs its entire
  // API surface mocked, and a test that expensive gets skipped rather than
  // extended. What matters here is narrow and checkable as text -- that the
  // control is wired to the shared arithmetic instead of hardcoding numbers
  // of its own, which is exactly how the label and the editor would drift.
  //
  // The markup moved out of Settings.tsx into LineSpacingControl on
  // 2026-09-01, so that both the Settings screen and the Audiobook Converter's
  // dialog could render it. The Converter's narration editor already obeyed
  // this setting; the knob was the part that lived somewhere you had to leave
  // the Converter to reach.
  const SOURCE = Object.values(
    import.meta.glob("../components/settings/LineSpacingControl.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  )[0];

  it("read the control at all", () => {
    expect(SOURCE?.length ?? 0).toBeGreaterThan(1000);
  });

  it("renders every option from the shared list, not a hand-typed copy", () => {
    expect(SOURCE).toContain("LINE_SPACING_OPTIONS.map");
  });

  it("shows the resolved number beside each option, to two decimals", () => {
    // This is the "[#.##] actual spacing indicator". Without it the writer is
    // choosing "Multiple" with no way to see what it produced.
    expect(SOURCE).toMatch(/resolveLineHeight\([^)]*\)\.toFixed\(2\)/);
  });

  it("clamps what the writer types rather than trusting it", () => {
    expect(SOURCE).toContain("clampMultiple");
  });

  it("keeps the custom input for Multiple only", () => {
    expect(SOURCE).toContain('spacing === "multiple" &&');
  });

  it("names colour ROLES only, so it themes itself inside the audiobook", () => {
    // The Converter is charcoal in both app themes. This renders there
    // unchanged, which only works because every colour it names is a role
    // that .audiobook-theme redefines.
    expect(SOURCE).not.toMatch(
      /(bg|text|border|ring)-(indigo|violet|emerald|amber|rose|red|blue|teal|sky|zinc|pink|cyan|lime|fuchsia)-[0-9]{2,3}/,
    );
  });

  it("is rendered by BOTH screens rather than copied into either", () => {
    const screens = {
      "Settings.tsx": Object.values(
        import.meta.glob("../screens/Settings.tsx", {
          query: "?raw", import: "default", eager: true,
        }) as Record<string, string>,
      )[0],
      "AudiobookSettingsDialog.tsx": Object.values(
        import.meta.glob("../features/audiobook/AudiobookSettingsDialog.tsx", {
          query: "?raw", import: "default", eager: true,
        }) as Record<string, string>,
      )[0],
    };
    for (const [name, source] of Object.entries(screens)) {
      expect(source?.length ?? 0, `${name} did not load`).toBeGreaterThan(1000);
      expect(source, `${name} must render <LineSpacingControl />`)
        .toContain("<LineSpacingControl");
      expect(
        source,
        `${name} builds its own spacing buttons instead of using the shared ` +
          "control -- that is the drift this extraction exists to prevent",
      ).not.toContain("LINE_SPACING_OPTIONS.map");
    }
  });

  it("does NOT carry paragraph spacing into the audiobook", () => {
    // Not an oversight, a fact about the surface: paragraph spacing works by
    // padding per-paragraph elements, and the narration editor is one plain
    // textarea with none to pad. A control that saves a value and changes
    // nothing visible is worse than an absent one.
    const dialog = Object.values(
      import.meta.glob("../features/audiobook/AudiobookSettingsDialog.tsx", {
        query: "?raw", import: "default", eager: true,
      }) as Record<string, string>,
    )[0];
    expect(dialog).not.toContain("PARAGRAPH_BEFORE_DEFAULT");
    expect(dialog).not.toContain("setParagraph");
  });
});

describe("the editor puts line-height where CodeMirror will honour it", () => {
  // THIS IS THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL BUG.
  //
  // CodeMirror's baseTheme contains `.cm-scroller { line-height: 1.4 }`.
  // .cm-scroller sits between .cm-editor and the text, and an explicit
  // line-height there blocks inheritance from the root -- so a line-height
  // declared on the "&" selector is never seen by a single line of prose.
  //
  // MarkdownEditor was written that way and rendered at 1.4 for its whole
  // life while the source said 1.8. Nothing errored, nothing looked broken,
  // and the dead declaration read as the answer to "what is the spacing?".
  // It only surfaced when the writer got a control that visibly did nothing:
  // "the Line spacing doesn't actually work ... currently 1.5 line spacing
  // yet nothing is showing."
  //
  // A rendering test cannot catch this -- jsdom does not apply CodeMirror's
  // baseTheme or do layout. So the selector is pinned as source.
  const SOURCE = Object.values(
    import.meta.glob("../components/MarkdownEditor.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  )[0];

  /** The `"&": { ... }` block of buildFontTheme. */
  function rootBlock(): string {
    const at = SOURCE.indexOf('"&": {');
    expect(at, 'no "&" block found in buildFontTheme').toBeGreaterThan(-1);
    return SOURCE.slice(at, SOURCE.indexOf("}", at));
  }

  /** The `".cm-content": { ... }` block. */
  function contentBlock(): string {
    const at = SOURCE.indexOf('".cm-content": {');
    expect(at, "no .cm-content block found").toBeGreaterThan(-1);
    return SOURCE.slice(at, SOURCE.indexOf("}", at));
  }

  it("read the editor source at all", () => {
    expect(SOURCE?.length ?? 0).toBeGreaterThan(1000);
  });

  it("sets lineHeight on .cm-content, where it survives .cm-scroller", () => {
    expect(contentBlock()).toContain("lineHeight");
  });

  it("does NOT set lineHeight on the root selector, where it dies silently", () => {
    expect(
      rootBlock(),
      'a lineHeight on "&" is overridden by CodeMirror\'s own ' +
        '.cm-scroller { line-height: 1.4 } and has no effect on the text',
    ).not.toContain("lineHeight");
  });

  it("takes the spacing as arguments rather than hardcoding it", () => {
    // Five now: the font, its SIZE, the line height, and the two paragraph
    // gaps. Size joined the list on 2026-09-01, when it stopped being the
    // literal "16px" that no setting could reach.
    expect(SOURCE).toMatch(/function buildFontTheme\(/);
    for (const arg of [
      "fontSizePx: number", "lineHeight: number",
      "spaceBefore: number", "spaceAfter: number",
    ]) {
      expect(SOURCE, `buildFontTheme should take ${arg}`).toContain(arg);
    }
    // And re-applies all of them when a setting changes, or the writer would
    // have to reopen the chapter to see their own choice.
    expect(SOURCE).toContain(
      "}, [font, fontSizePx, lineHeight, spaceBefore, spaceAfter]);",
    );
  });

  it("puts font-size on the root, and NOT as a literal", () => {
    // The mirror of the lineHeight pair above, and the reason the two rules
    // differ is a fact about CodeMirror's baseTheme rather than a preference:
    // .cm-scroller declares line-height (so a line-height on "&" dies) and
    // declares no font-size (so a font-size on "&" inherits cleanly).
    const root = rootBlock();
    expect(root, "font-size should be set on the editor root").toContain("fontSize");
    expect(
      root,
      'a hardcoded pixel size here is what made the editor ignore every size ' +
        'setting for its entire life -- it must come from useEditorFontSize',
    ).not.toMatch(/fontSize:\s*["'`]\d/);
  });

  it("does not set font-size on .cm-content or .cm-line, which would shadow it", () => {
    // A size on either of these wins over the root, so the setting would move
    // the root and change nothing visible -- the same silent shape as the
    // line-height bug, in the opposite direction.
    expect(contentBlock()).not.toContain("fontSize");
  });
});
