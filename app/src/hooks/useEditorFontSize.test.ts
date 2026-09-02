// useEditorFontSize.test.ts -- the size of the writer's own prose
// ================================================================
// WHAT THIS IS DEFENDING, and it is a bug rather than a feature.
//
// MarkdownEditor's CodeMirror theme contained `"&": { fontSize: "16px" }` from
// the day the editor was written. An absolute pixel value, so useUiScale --
// which works by setting font-size on <html> and therefore only moves rem
// utilities -- could not touch it. The manuscript rendered at exactly 16px at
// every Interface size step, for the editor's entire life.
//
// Nothing failed. 16px is an ordinary size to read, and three separate comments
// in the codebase asserted the editor font was handled "by the font picker in
// the editor toolbar" -- a picker that chooses a font FAMILY and does not even
// persist. A false comment is why nobody went looking.
//
// The arithmetic below is the part that must not drift: the Settings screen
// prints what it is about to apply and CodeMirror applies it, and both go
// through resolveEditorFontPx so the label and the page cannot disagree.

import { describe, it, expect } from "vitest";
import {
  PX_PER_PT,
  EDITOR_PT_MIN,
  EDITOR_PT_MAX,
  EDITOR_PT_DEFAULT,
  EDITOR_FONT_OPTIONS,
  clampEditorPt,
  resolveEditorFontPx,
} from "./useEditorFontSize";

describe("points to pixels", () => {
  it("12pt is EXACTLY 16px -- the literal this control replaced", () => {
    // THE pin. MarkdownEditor.tsx hardcoded "16px", and the whole reason this
    // setting defaults to 12pt is that the two are the same number: a writer
    // who never opens the control must see the app they had yesterday.
    //
    // If this ever fails, an upgrade silently reflows every manuscript in the
    // wild. It is not a rounding detail.
    expect(resolveEditorFontPx(EDITOR_PT_DEFAULT)).toBe(16);
    expect(EDITOR_PT_DEFAULT).toBe(12);
  });

  it("uses the real CSS ratio, 96dpi over 72pt", () => {
    expect(PX_PER_PT).toBeCloseTo(4 / 3, 10);
    expect(resolveEditorFontPx(9)).toBe(12);
    expect(resolveEditorFontPx(18)).toBe(24);
    expect(resolveEditorFontPx(24)).toBe(32);
  });

  it("rounds to two decimals rather than handing CodeMirror a repeating decimal", () => {
    // 11pt is 14.666... px. The Settings label prints this same number, and
    // "14.666666666666666px" in a button is not a size anyone can read.
    expect(resolveEditorFontPx(11)).toBe(14.67);
  });

  it("resolves through the clamp, so an out-of-range value cannot reach the page", () => {
    expect(resolveEditorFontPx(999)).toBe(resolveEditorFontPx(EDITOR_PT_MAX));
    expect(resolveEditorFontPx(1)).toBe(resolveEditorFontPx(EDITOR_PT_MIN));
  });
});

describe("clamping a typed-in size", () => {
  it("keeps a sensible number as it is", () => {
    expect(clampEditorPt(14)).toBe(14);
    expect(clampEditorPt(12.5)).toBe(12.5);
  });

  it("clamps both ends", () => {
    expect(clampEditorPt(0)).toBe(EDITOR_PT_MIN);
    expect(clampEditorPt(-40)).toBe(EDITOR_PT_MIN);
    expect(clampEditorPt(500)).toBe(EDITOR_PT_MAX);
  });

  it("treats Infinity as a real value with a real clamp, not as garbage", () => {
    // The exact bug clampMultiple had in useEditorSpacing: Infinity was lumped
    // in with NaN and reset the writer to the default. A writer who holds a key
    // down has not typed nonsense -- they have typed a very large number, and
    // the ceiling is the honest answer.
    expect(clampEditorPt(Infinity)).toBe(EDITOR_PT_MAX);
    expect(clampEditorPt(-Infinity)).toBe(EDITOR_PT_MIN);
  });

  it("falls back to the DEFAULT on NaN, not to zero or the minimum", () => {
    // NaN means "the writer typed something that is not a number". The least
    // surprising answer is the size they started at; the minimum would shrink
    // their manuscript as a punishment for a typo.
    expect(clampEditorPt(NaN)).toBe(EDITOR_PT_DEFAULT);
  });
});

describe("the sizes offered", () => {
  it("brackets the default with real choices and ends in Custom", () => {
    const ids = EDITOR_FONT_OPTIONS.map(o => o.id);
    expect(ids).toContain(EDITOR_PT_DEFAULT);
    expect(ids[ids.length - 1]).toBe("custom");
    // Custom appears exactly once, or the "is this a custom value" check in
    // Settings would have two answers.
    expect(ids.filter(i => i === "custom")).toHaveLength(1);
  });

  it("offers only sizes the clamp will actually honour", () => {
    // A button that silently applies something else is worse than no button.
    for (const opt of EDITOR_FONT_OPTIONS) {
      if (typeof opt.id !== "number") continue;
      expect(
        clampEditorPt(opt.id),
        `${opt.label} is outside ${EDITOR_PT_MIN}-${EDITOR_PT_MAX} and would be clamped`,
      ).toBe(opt.id);
    }
  });

  it("labels every option in points, the unit the control is in", () => {
    for (const opt of EDITOR_FONT_OPTIONS) {
      if (typeof opt.id !== "number") continue;
      expect(opt.label).toBe(`${opt.id} pt`);
    }
  });

  it("has no em dashes in any label (locked product rule)", () => {
    for (const opt of EDITOR_FONT_OPTIONS) {
      expect(opt.label).not.toMatch(/[–—]/);
    }
  });
});

describe("the bounds themselves", () => {
  it("puts the default strictly inside the range", () => {
    expect(EDITOR_PT_MIN).toBeLessThan(EDITOR_PT_DEFAULT);
    expect(EDITOR_PT_DEFAULT).toBeLessThan(EDITOR_PT_MAX);
  });

  it("never lets the floor be smaller than the app has ever rendered", () => {
    // This control exists to fix eye strain. A floor below 9pt (12px) would
    // let it make the reported problem worse than the state it was reported in.
    expect(EDITOR_PT_MIN).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// ONE CONTROL, RENDERED TWICE
// ---------------------------------------------------------------------------
// Interface size and Editor text size live in TextSizeControls, which BOTH the
// Settings screen and the Audiobook Converter's settings dialog render.
//
// The Converter is a full-screen world with its own sidebar and its own
// settings dialog and no route back to app Settings, so a writer working on
// narration who wanted the text bigger had to leave the Converter, change it,
// and come back. Reported as: "I asked for the Font size and text editor size
// settings to be mirrored over on the Audiobook Settings."
//
// It is EXTRACTED rather than copied, which is this repo's standing rule --
// a second place to change a setting through a second component is two
// vocabularies for one idea, and they drift. These tests hold that: the
// arithmetic lives in the hook, the markup lives in one component, and both
// screens render that component rather than their own version of it.

describe("the size controls are one component using the shared helpers", () => {
  const CONTROL = Object.values(
    import.meta.glob("../components/settings/TextSizeControls.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  )[0];

  it("read the control source at all", () => {
    expect(CONTROL?.length ?? 0).toBeGreaterThan(1000);
  });

  it("renders the options from the exported list", () => {
    expect(CONTROL).toContain("EDITOR_FONT_OPTIONS.map");
  });

  it("prints the resolved pixel size rather than computing its own", () => {
    expect(CONTROL).toContain("resolveEditorFontPx(");
    expect(
      CONTROL,
      "the control must not do the pt->px sum itself; that is what drifts",
    ).not.toContain("* (4 / 3)");
  });

  it("clamps the custom value through the shared clamp", () => {
    expect(CONTROL).toContain("clampEditorPt(");
  });

  it("commits the custom number on blur, not on every keystroke", () => {
    // Applying per keystroke reflows the manuscript underneath a writer typing
    // "2" on the way to "24". The line-spacing control learned this first.
    expect(CONTROL).toContain("onBlur={() => {");
  });

  it("names colour ROLES only, so it themes itself inside the audiobook", () => {
    // The Converter is charcoal in both app themes. This component renders
    // there unchanged, which only works because every colour it names is a
    // role that .audiobook-theme redefines. A raw shade would arrive as a
    // writing-app colour in the middle of the charcoal world.
    expect(
      CONTROL,
      "use bg-bg-panel / text-text-muted / border-accent-fill, never a " +
        "Tailwind palette shade -- see the .audiobook-theme block in App.css",
    ).not.toMatch(
      /(bg|text|border|ring)-(indigo|violet|emerald|amber|rose|red|blue|teal|sky|zinc|pink|cyan|lime|fuchsia)-[0-9]{2,3}/,
    );
  });

  it("is rendered by BOTH screens, rather than copied into either", () => {
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
      expect(
        source,
        `${name} must render <TextSizeControls />`,
      ).toContain("<TextSizeControls");
      // And must not have grown its own copy of the buttons.
      expect(
        source,
        `${name} builds its own size buttons instead of using the shared ` +
          "control -- that is the drift this extraction exists to prevent",
      ).not.toContain("EDITOR_FONT_OPTIONS.map");
    }
  });
});
