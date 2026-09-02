// App.css.test.ts -- the design system's two load-bearing promises
// =================================================================
// App.css carries two rules that nothing could check until now. Both fail
// SILENTLY when broken, which is exactly the class of bug this repo keeps
// finding by reading rather than by running.
//
//   1. A token declared in one theme and forgotten in the other.
//      App.css has said "declare it in BOTH" in a comment since it was
//      written. A comment is not a gate. The symptom is a colour that looks
//      right in dark mode and is invisible, or inherited from somewhere
//      unrelated, in light mode -- and nobody runs the whole app in light
//      mode on every change.
//
//   2. The audiobook boundary leaking.
//      `.audiobook-theme` overrides the role tokens so the Audiobook
//      Converter keeps its charcoal world. GuidedWalk and WhatsThis are
//      imported by BOTH sides and now name roles, so that block is the only
//      thing standing between them and the writing app's palette. Its own
//      tests would not catch a leak: they assert class names, not colours.
//
//   3. A raw Tailwind palette class reappearing in the main app.
//      There used to be a bridge re-aiming Tailwind's palette at these roles,
//      which made a stray `text-indigo-300` render as the accent. It is gone,
//      so one now renders in stock Tailwind indigo -- close enough to look
//      deliberate and wrong enough to matter.
//
// Reading the stylesheet as text is deliberate. Rendering cannot see an
// unused variable, and that is precisely what goes wrong.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read from disk rather than through Vite. `import.meta.glob(..., "?raw")`
// returns an EMPTY STRING for a stylesheet here -- the CSS plugin claims the
// file before the raw loader sees it -- and an empty string would make every
// assertion below pass while checking nothing. Hence also the length guard:
// a test that reads nothing and asserts over nothing is worse than no test.
//
// Line endings are normalised because this repo is genuinely mixed: App.css
// is LF and MarkdownEditor.tsx next door is CRLF.
const CSS = readFileSync(resolve(process.cwd(), "src/App.css"), "utf-8")
  .split("\r\n")
  .join("\n");
if (CSS.length < 1000) {
  throw new Error(`App.css read back as ${CSS.length} chars -- the read is broken, not the CSS`);
}

/**
 * Pull one rule body out of the stylesheet by its exact selector header.
 *
 * Deliberately naive -- these blocks contain no nested braces, so counting
 * to the first `}` is correct and a real CSS parser would be a dependency
 * bought for nothing. If a block ever gains nesting, this throws rather than
 * silently returning half of it.
 */
function block(selector: string): string {
  const start = CSS.indexOf(selector + " {");
  if (start === -1) throw new Error(`Block not found in App.css: ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  if (close === -1) throw new Error(`Unterminated block: ${selector}`);
  const body = CSS.slice(open + 1, close);
  if (body.includes("{")) throw new Error(`Unexpected nesting in: ${selector}`);
  return body;
}

/** Every custom property NAME declared in a block, with comments stripped. */
function declaredVars(body: string, prefix: string): Set<string> {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, " ");
  const names = new Set<string>();
  for (const m of withoutComments.matchAll(
    new RegExp(`(${prefix}[a-z0-9-]+)\\s*:`, "g"),
  )) {
    names.add(m[1]);
  }
  return names;
}

// The three blocks the system is built from. A fourth used to sit between
// them -- the bridge, on a two-line `:root, [data-theme="light"]` selector --
// and it is gone now that every call site outside features/audiobook names a
// role rather than a shade.
const DARK = block(":root");
const LIGHT = block('[data-theme="light"]');
const AUDIOBOOK = block(".audiobook-theme");
// The Converter's light half, added 2026-09-02. Its own attribute rather than
// [data-theme="light"], so the two sides of the app stay independent.
const AUDIOBOOK_LIGHT = block('.audiobook-theme[data-ab-theme="light"]');

describe("App.css -- both themes define the same tokens", () => {
  it("declares every --st-* role token in dark and light alike", () => {
    const dark = declaredVars(DARK, "--st-");
    const light = declaredVars(LIGHT, "--st-");

    // Named individually rather than as a set comparison so a failure says
    // WHICH token, which is the whole point of the test.
    const missingFromLight = [...dark].filter(v => !light.has(v)).sort();
    const missingFromDark = [...light].filter(v => !dark.has(v)).sort();

    expect(missingFromLight, "declared in :root but not in light").toEqual([]);
    expect(missingFromDark, "declared in light but not in :root").toEqual([]);
  });

  it("actually has tokens to check (guards against a parser that found nothing)", () => {
    // A test that silently matches zero things passes forever. This is the
    // same reason test_planning_sources.py keeps a floor on its vocabulary.
    expect(declaredVars(DARK, "--st-").size).toBeGreaterThan(40);
  });
});

describe("the Converter's light half", () => {
  // Spec 5.0 used to say charcoal in BOTH app themes, and the argument was
  // sound: the writer should always know which side of the app they are in.
  // It is now the writer's choice instead, on their ruling, and the spec is
  // amended to match. These pin the parts of that decision that would
  // otherwise rot.

  it("hangs off its own attribute, not the writing app's theme", () => {
    // Coupling it to [data-theme="light"] would forbid a dark writing app
    // beside a paper Converter, and would make the app's theme switch
    // silently restyle a feature the writer was not looking at.
    expect(CSS).toMatch(/\.audiobook-theme\[data-ab-theme="light"\]\s*\{/);
    expect(CSS).not.toMatch(/\[data-theme="light"\]\s*\.audiobook-theme/);
  });

  it("declares color-scheme, or the OS keeps drawing dark chrome", () => {
    // Scrollbars and <select> popups are drawn outside the page; no custom
    // property reaches them. This is the bug the writing app's light theme
    // shipped with before v2.0.2.
    expect(AUDIOBOOK_LIGHT).toMatch(/color-scheme:\s*light/);
  });

  it("overrides every role the charcoal half declares", () => {
    // A token declared in charcoal and forgotten here inherits the charcoal
    // value, which on cream is a dark patch with no control explaining it.
    const dark = declaredVars(AUDIOBOOK, "--st-");
    const light = declaredVars(AUDIOBOOK_LIGHT, "--st-");
    const missing = [...dark].filter(v => !light.has(v)).sort();
    expect(
      missing,
      "these are set for charcoal but not for paper, so they keep their "
        + "charcoal value inside a light Converter",
    ).toEqual([]);
  });

  it("declares the section stripes the charcoal half leaves to :root", () => {
    // The charcoal block can inherit --st-kind-* from :root because both are
    // dark. On paper those same values are pale washes, so the light half has
    // to say. Without this the sidebar stripes would be the one thing in a
    // paper Converter still coloured for charcoal.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(AUDIOBOOK_LIGHT, `--st-kind-${n} missing`).toMatch(
        new RegExp(`--st-kind-${n}\s*:`),
      );
    }
  });

  it("recedes its inset instead of floating it, unlike the charcoal half", () => {
    // Charcoal has bg-surface LIGHTER than its panel, which is fine on
    // charcoal and reads as a tile sitting on top of a card on paper. The
    // light half follows the writing app's rule instead: surfaces alternate,
    // they do not climb.
    const lightnessOf = (name: string) => {
      const m = AUDIOBOOK_LIGHT.match(
        new RegExp(`--st-${name}:[ 	]*#([0-9A-Fa-f]{6})`),
      );
      expect(m, `--st-${name} is not a 6-digit hex here`).toBeTruthy();
      const [r, g, b] = [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16));
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    expect(lightnessOf("bg-surface")).toBeLessThanOrEqual(lightnessOf("bg-panel"));
  });
});

describe("the audiobook boundary still holds", () => {
  it("overrides the role tokens, so shared components follow it", () => {
    // The PIN list is gone with the bridge -- nothing remaps Tailwind's
    // palette any more, so stock is simply what it is. These are the part
    // that still matters: GuidedWalk and WhatsThis are imported by BOTH
    // sides, and now that they name roles instead of zinc, this block is the
    // only thing keeping them charcoal inside the Audiobook Converter.
    const roles = declaredVars(AUDIOBOOK, "--st-");
    for (const required of [
      "--st-bg-primary", "--st-bg-panel", "--st-bg-surface",
      "--st-text-primary", "--st-text-muted", "--st-border",
      "--st-accent", "--st-danger", "--st-warn", "--st-success",
    ]) {
      expect(roles.has(required), `.audiobook-theme must override ${required}`).toBe(true);
    }
  });

  it("is declared exactly once, and not for light mode", () => {
    expect(CSS.match(/^\.audiobook-theme\s*\{/gm)?.length ?? 0).toBe(1);
    // Charcoal in BOTH themes: the writer should always know which side of
    // the app they are standing in.
    expect(CSS).not.toMatch(/\[data-theme="light"\]\s*\.audiobook-theme/);
  });

  it("no longer pins Tailwind's palette, because nothing remaps it", () => {
    expect(declaredVars(AUDIOBOOK, "--color-").size).toBe(0);
  });
});

describe("App.css -- surfaces alternate, they do not climb", () => {
  /** Parse `--st-name: #rrggbb;` out of a block. */
  function hex(body: string, name: string): number[] {
    // [ \t]* rather than \s* on purpose: this regex is built from a template
    // literal, where a lone backslash-s is silently just "s".
    const m = body.match(new RegExp(`--st-${name}:[ \t]*#([0-9A-Fa-f]{6})`));
    expect(m, `--st-${name} not found or not a 6-digit hex`).toBeTruthy();
    const v = m![1];
    return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
  }

  /** Rough perceptual lightness. Exact weighting does not matter here. */
  function lightness(rgb: number[]): number {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  }

  for (const [themeName, body] of [["dark", DARK], ["light", LIGHT]] as const) {
    it(`${themeName}: an inset never floats above the panel it sits in`, () => {
      // THE RULE, in the writer's words: "The grey-blue on top of charcoal and
      // charcoal on top of grey-blue." An input is a well you type INTO, not a
      // tile sitting on top of the dialog. The first build made bg-surface a
      // LIGHTER grey than the panel and that is exactly what was rejected:
      // "the text windows are a lighter shade ... not appealing."
      const panel = lightness(hex(body, "bg-panel"));
      const inset = lightness(hex(body, "bg-surface"));
      expect(
        inset,
        `--st-bg-surface is lighter than --st-bg-panel in ${themeName}, so ` +
          `inputs would float above the dialog instead of sinking into it`,
      ).toBeLessThanOrEqual(panel);
    });

    it(`${themeName}: hover is the one surface that really does lift`, () => {
      // In light mode "lift" means tint DOWN -- on cream, a darker patch is
      // what reads as "the pointer is here" -- so this only checks that hover
      // is distinct from the panel, not which direction it went.
      const panel = lightness(hex(body, "bg-panel"));
      const raised = lightness(hex(body, "bg-raised"));
      expect(Math.abs(raised - panel)).toBeGreaterThan(4);
    });
  }
});

describe("hover uses the token that exists for it", () => {
  const SOURCES = import.meta.glob("./**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("never reaches for bg-bg-surface on hover", () => {
    // bg-bg-surface is now the RECESSED inset. Hovering with it would darken
    // the row instead of lifting it. 53 call sites did exactly that while
    // bg-bg-raised -- the token that exists for hover -- had zero users, and
    // that mismatch is what made changing bg-surface risky in the first place.
    //
    // features/audiobook is excluded: it pins its own values behind
    // .audiobook-theme and its hover behaviour is not ours to change.
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.includes("/audiobook/"))
      .filter(([, src]) => /hover:bg-bg-surface\b/.test(src))
      .map(([path]) => path);

    expect(offenders, "use hover:bg-bg-raised instead").toEqual([]);
  });
});

describe("no raw Tailwind palette outside the audiobook", () => {
  // THE INVARIANT THAT LET THE BRIDGE GO. While it existed, a stray
  // `text-indigo-300` resolved to the accent and looked right. Without it the
  // same class renders in stock Tailwind indigo, which is close enough to
  // look deliberate in a screenshot and wrong enough to be a bug.
  //
  // features/audiobook is excluded because its palette IS raw Tailwind, on
  // purpose, scoped behind .audiobook-theme.
  const SOURCES = import.meta.glob(["./**/*.tsx", "./**/*.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  // A literal, not a built string. `"\b"` inside a JS string is a BACKSPACE
  // character, so a word boundary written that way matches nothing and the
  // whole gate passes while checking for something that cannot occur.
  const PALETTE =
    /\b(?:bg|text|border|ring|fill|stroke|from|to|via|caret|divide|placeholder)-(?:indigo|violet|emerald|amber|rose|red|blue|teal|sky|zinc|pink|cyan|lime|fuchsia)-[0-9]{2,3}\b/g;

  it("found the sources at all", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(150);
  });

  it("names a role everywhere, never a shade", () => {
    // features/audiobook IS NO LONGER EXCLUDED, as of 2026-09-02.
    //
    // It was, for two releases, and the exemption was honest at the time: that
    // side had its own charcoal palette written directly as zinc and jewel
    // shades, and there was no light theme for them to fail in. Giving the
    // Converter a theme switch changed that -- a literal `bg-zinc-900` cannot
    // follow anything, so 940 classes were converted onto role tokens.
    //
    // The conversion was near zero-delta in dark because .audiobook-theme was
    // BUILT from those shades: --st-bg-panel IS zinc-900, --st-accent IS
    // emerald-300. Dropping the exclusion is what stops the next component
    // added there from being invisible to the light theme.
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith("/App.css.test.ts")) continue;   // quotes the pattern
      const hits = source.match(PALETTE);
      if (hits) offenders.push(`${path}: ${[...new Set(hits)].sort().join(", ")}`);
    }
    expect(
      offenders,
      "these name a Tailwind shade rather than a role, and there is no longer "
        + "a bridge making that resolve to the right colour. Use bg-bg-panel, "
        + "text-accent, border-danger and friends -- see App.css.",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE CONTRAST CONTRACT
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. A prospective user could not evaluate the app at all:
// "the Light color scheme is causing a very fast headache from eye strain. It
// breaks the cardinal rule of UI design 'Never decrease the contrast of the
// small text unless you have an excellent reason (such as using gray text to
// indicate disabled and thus irrelevant controls)."
//
// They were right, and nothing in the build was in a position to notice. A
// colour that is too pale raises no error, fails no test, and looks fine in a
// screenshot to whoever chose it. Light --st-faint measured 2.78:1 -- the worst
// number in the app -- against a WCAG AA floor of 4.5:1, on a token carrying
// 504 call sites, 183 of them at 9-11px.
//
// So the floor is computed here, from the same file the app renders from,
// rather than trusted to a comment recording that somebody once measured it.

describe("App.css -- every ink token is readable on every surface it lands on", () => {
  type RGBA = { r: number; g: number; b: number; a: number };

  /**
   * Parse one colour token, in either shape the stylesheet uses:
   * `#rrggbb` (the audiobook block) or `rgb(R G B / A)` (dark and light).
   *
   * The existing hex() helper above deliberately handles 6-digit hex ONLY,
   * because the surface tokens it reads are always opaque. The ink tokens are
   * not, and an alpha-blind parser here would read every one of them as fully
   * opaque and cheerfully pass while checking nothing.
   */
  function color(body: string, name: string): RGBA {
    const hexMatch = body.match(
      new RegExp(`--st-${name}:[ \t]*#([0-9A-Fa-f]{6})`),
    );
    if (hexMatch) {
      const v = hexMatch[1];
      const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
      return { r, g, b, a: 1 };
    }
    const rgbMatch = body.match(
      new RegExp(
        `--st-${name}:[ \t]*rgb\\(\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*/\\s*([0-9.]+)\\s*\\)`,
      ),
    );
    expect(
      rgbMatch,
      `--st-${name} is neither #rrggbb nor rgb(R G B / A) -- the parser cannot ` +
        `read it, so it would be silently skipped rather than checked`,
    ).toBeTruthy();
    const m = rgbMatch!;
    return {
      r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]),
    };
  }

  /** Composite a translucent ink onto an opaque surface -- what the eye sees. */
  function over(fg: RGBA, bg: RGBA): RGBA {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    };
  }

  /** WCAG 2.x relative luminance. The 0.03928 knee is part of the spec. */
  function luminance(c: RGBA): number {
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }

  function contrast(fg: RGBA, bg: RGBA): number {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /** WCAG AA for normal-size text. Our small text is well under 18.66px. */
  const AA_NORMAL = 4.5;

  const INKS = ["text-primary", "text-muted", "faint"] as const;

  // THE SURFACE SET IS AN EXPLICIT DECISION, NOT A LOOP OVER WHATEVER IS
  // DECLARED. Listing them by hand is what makes the audiobook exemption below
  // a stated argument rather than a silent omission.
  const INK_CONTRACT = [
    {
      theme: "dark",
      body: DARK,
      surfaces: ["bg-primary", "bg-panel", "bg-surface", "bg-raised"],
    },
    {
      theme: "light",
      body: LIGHT,
      surfaces: ["bg-primary", "bg-panel", "bg-surface", "bg-raised"],
    },
    {
      // .audiobook-theme's --st-bg-raised (#3f3f46, zinc-700) is DELIBERATELY
      // absent, and this is the one exemption in the contract.
      //
      // It cannot be included: --st-faint would have to reach #b0b0b8 to clear
      // 4.5:1 against it, which is LIGHTER than --st-text-muted -- the ladder
      // would invert and the three levels would stop meaning anything.
      // Darkening raised to #2d2d33 only reaches 4.54.
      //
      // This is a pre-existing hole rather than one the retune opened: today's
      // muted #a1a1aa manages only 4.07 there. It is a hover tint painted
      // behind a row, not a surface body copy rests on. Measured 2026-09-01.
      // If a resting surface is ever painted --st-bg-raised in this theme, the
      // exemption is wrong and this comment is where to start.
      theme: "audiobook",
      body: AUDIOBOOK,
      surfaces: ["bg-primary", "bg-panel", "bg-surface"],
    },
    {
      // The Converter on paper. ALL FOUR surfaces, unlike the charcoal half:
      // this block declares its own bg-raised as a warm tint rather than
      // zinc-700, so the exemption above does not apply to it and there is no
      // reason to let it off.
      theme: "audiobook-light",
      body: AUDIOBOOK_LIGHT,
      surfaces: ["bg-primary", "bg-panel", "bg-surface", "bg-raised"],
    },
  ] as const;

  it("the luminance maths is right (white on black is 21:1)", () => {
    // A self-test of the curve above. Every assertion in this describe block
    // is only as trustworthy as this one number.
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrast(white, black)).toBeCloseTo(21, 1);
  });

  it("the parser really reads alpha (guards against an opaque-blind read)", () => {
    // If color() returned a: 1 for everything, every ratio below would be
    // computed against the wrong colour and the suite would pass while
    // checking nothing. At least one ink must come back translucent.
    const alphas = INKS.map(ink => color(DARK, ink).a);
    expect(
      alphas.some(a => a > 0 && a < 1),
      "no ink token in :root parsed as translucent -- the rgb(R G B / A) " +
        "branch is not firing and the ratios below are meaningless",
    ).toBe(true);
  });

  for (const { theme, body, surfaces } of INK_CONTRACT) {
    it(`${theme}: every ink clears AA on every surface it is painted on`, () => {
      const failures: string[] = [];

      for (const ink of INKS) {
        const fg = color(body, ink);
        for (const surfaceName of surfaces) {
          const bg = color(body, surfaceName);
          const ratio = contrast(over(fg, bg), bg);
          if (ratio < AA_NORMAL) {
            failures.push(
              `--st-${ink} on --st-${surfaceName}: ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }

      // Naming theme, ink, surface and the computed ratio is the whole value
      // of this test -- "contrast failed" would send the next person back to a
      // spreadsheet.
      expect(
        failures,
        `${theme}: these fall below the AA floor of ${AA_NORMAL}:1 for normal ` +
          `text. Raise the ink's alpha in App.css (or darken/lighten the ` +
          `surface); do NOT lower this floor.`,
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// A COLOUR CLASS THAT NAMES NOTHING
// ---------------------------------------------------------------------------
// DialogueCheck.tsx carried `text-text-secondary` at eight call sites, four of
// them body copy. There is no --color-text-secondary in @theme inline, so
// Tailwind generated no rule at all and those elements silently inherited
// whatever colour their parent happened to have.
//
// It renders as *something*, so it never looked broken; it just was not the
// colour anyone chose, and no theme, token or contrast check could reach it.
// That is the same shape as the rest of this file's quarry: a declaration
// connected to nothing.

describe("every colour class names a role that exists", () => {
  const SOURCES = import.meta.glob(["./**/*.tsx", "./**/*.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  /**
   * The role names Tailwind actually generates `text-*` utilities for.
   *
   * declaredVars returns the FULL custom-property name (`--color-faint`), and
   * the class carries only the tail (`text-faint`), so the prefix is stripped
   * here. Getting this wrong does not break the test loudly -- every lookup
   * simply misses and the gate reports all 1,100 legitimate call sites as
   * offenders, which is how it first ran.
   */
  const ROLES = new Set(
    [...declaredVars(block("@theme inline"), "--color-")].map(v =>
      v.slice("--color-".length),
    ),
  );

  /** Plain classes App.css defines itself, e.g. `.text-entry`. */
  const CSS_CLASSES = new Set(
    [...CSS.matchAll(/^\.(text-[a-z0-9-]+)\s*\{/gm)].map(m => m[1].slice(5)),
  );

  // Tailwind's own keywords, which are not roles and never will be.
  const BUILTIN = new Set(["white", "black", "transparent", "current", "inherit"]);

  // text-* utilities that size or align rather than colour.
  const NOT_A_COLOUR =
    /^(xs|sm|base|lg|xl|[2-9]xl|2xs|micro|mini|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis)$/;

  /**
   * Comments are stripped first. Without this the scan trips over English
   * prose ("the text-only filter"), a CSS block inside a template literal
   * ("text-align: center") and comments naming a token -- eight false
   * positives, which is how a gate acquires an allowlist and stops being one.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  }

  it("found the sources and the role list at all", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(150);
    expect(ROLES.size).toBeGreaterThan(20);
  });

  it("has no text-<role> class without a --color-<role> behind it", () => {
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes("/audiobook/")) continue;
      if (path.endsWith("/App.css.test.ts")) continue;   // quotes the pattern

      const clean = stripComments(source);
      const bad = new Set<string>();

      // Only inside a class/className attribute. A bare `text-foo` in a string
      // somewhere is not a rendered class and is not this test's business.
      for (const attr of clean.matchAll(
        /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{([^}]*)\})/g,
      )) {
        const value = attr[1] ?? attr[2] ?? attr[3] ?? attr[4] ?? "";
        for (const m of value.matchAll(/(?:^|[\s"'`:])text-(?!\[)([a-z][a-z0-9-]*)/g)) {
          const token = m[1];
          if (NOT_A_COLOUR.test(token)) continue;
          if (ROLES.has(token) || CSS_CLASSES.has(token) || BUILTIN.has(token)) continue;
          bad.add(`text-${token}`);
        }
      }

      if (bad.size) offenders.push(`${path}: ${[...bad].sort().join(", ")}`);
    }

    expect(
      offenders,
      "these name a colour role that is not declared in App.css's @theme " +
        "inline block, so Tailwind emits no rule and the element inherits its " +
        "parent's colour instead. Declare the role in BOTH themes, or use an " +
        "existing one (text-text-primary / text-text-muted / text-faint).",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A COLOUR CHOSEN TWICE
// ---------------------------------------------------------------------------
// The tokens above are measured, but a token only decides the colour that
// REACHES the element. An `opacity` utility on the same element then multiplies
// it, and nothing in the contrast contract can see that -- text-faint at
// opacity-40 lands near 0.22 effective alpha in dark, well under half the floor
// the stylesheet just guaranteed.
//
// THE RULE, and it is the writer's own exception made mechanical:
//
//   "Never decrease the contrast of the small text unless you have an excellent
//    reason (such as using gray text to indicate disabled and thus irrelevant
//    controls)."
//
//   A CONDITIONAL opacity is a state, and low contrast is the correct rendering
//   of a control you cannot use. `disabled:opacity-40` is right, and WCAG 1.4.3
//   exempts inactive components explicitly. `opacity-0 ... group-hover:
//   opacity-100` is a reveal, not a dim; it ends at full.
//
//   An UNPREFIXED opacity is a colour decision made a second time, in a place
//   no theme, token or contrast check can reach.
//
// So this bans exactly the compounding case and nothing else. A blanket ban on
// opacity would be wrong and would be allowlisted into uselessness within a
// month.

describe("no dim ink is dimmed a second time", () => {
  const SOURCES = import.meta.glob("./**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  /** The two ink roles that are already below full strength by design. */
  const DIM_INK = /\btext-(faint|text-muted)\b/;

  /**
   * `opacity-NN` with no variant in front of it.
   *
   * The lookbehind excluding ":" is what separates a dim from a state --
   * without it this matches `disabled:opacity-40` and flags 51 perfectly
   * correct call sites, which is how it first ran. "/" and word characters are
   * excluded too, so `group-hover/row:opacity-100` does not slip through the
   * ":" check by a different route.
   */
  const UNPREFIXED_OPACITY = /(?<![:\w/-])opacity-(\d+)/g;

  it("found the sources at all", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(150);
  });

  it("has no unprefixed opacity on text that is already faint or muted", () => {
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith(".test.tsx")) continue;   // fixtures may assert on them

      for (const attr of source.matchAll(
        /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g,
      )) {
        const value = attr[1] ?? attr[2] ?? attr[3] ?? "";
        if (!DIM_INK.test(value)) continue;

        for (const m of value.matchAll(UNPREFIXED_OPACITY)) {
          const amount = Number(m[1]);
          // 0 and 100 are the two ends of a reveal, not a dim.
          if (amount === 0 || amount === 100) continue;
          offenders.push(`${path}: opacity-${amount} on ${value.trim().slice(0, 80)}`);
        }
      }
    }

    expect(
      offenders,
      "these fade text that is ALREADY faint or muted, so the real contrast is " +
        "the token's ratio multiplied by this opacity -- invisible to the ink " +
        "contract above. If it marks an unusable control, write it as " +
        "`disabled:opacity-NN` so the class says so. If it marks a STATE " +
        "(already added, already established), use a border, a ring or an icon " +
        "and leave the text readable.",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE AUDIOBOOK'S TYPE RAMP
// ---------------------------------------------------------------------------
// The Audiobook Converter was built a full step smaller than the writing app.
// Nothing caught it, because every size on that side is a legitimate rem step
// that scales with Interface size exactly as it should -- there was no broken
// control to find, just a different design:
//
//              <= 11px      of total size classes
//   main app     41%
//   audiobook    72%        (CastPanel: 48 of 52)
//
// A writer who set Interface size for the writing app arrived here and found
// everything a notch smaller, which is what "this screen appears to have
// different font size problems" was reporting.
//
// The fix is one block rather than 247 edits: Tailwind v4 compiles `text-mini`
// to `font-size: var(--text-mini)`, reading the variable at USE time, so
// redefining the step inside `.audiobook-theme` moves every call site in that
// subtree. These tests exist because that mechanism is invisible in the source
// -- if Tailwind ever inlined the value instead, the override would silently
// do nothing and every audiobook screen would quietly go back to being small.

describe("the audiobook type ramp sits one step above the writing app's", () => {
  /** `--text-name: 0.75rem` out of a block, in rem. */
  function remStep(body: string, name: string): number {
    const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, " ");
    const m = withoutComments.match(new RegExp(`--text-${name}:[ \t]*([0-9.]+)rem`));
    expect(m, `--text-${name} not found (or not in rem) in this block`).toBeTruthy();
    return parseFloat(m![1]);
  }

  // The app-wide steps. `block("@theme")` cannot match `@theme inline {`,
  // because block() searches for the selector followed by " {" exactly.
  const THEME = block("@theme");

  const SHARED_STEPS = ["2xs", "micro", "mini"] as const;

  it("declares its own ramp at all", () => {
    // If this block stops declaring them, the audiobook silently reverts to
    // the smaller global ramp and nothing else in this file would notice.
    for (const step of ["2xs", "micro", "mini", "xs", "sm"]) {
      expect(
        AUDIOBOOK,
        `.audiobook-theme must declare --text-${step}; without it this screen ` +
          "goes back to rendering a step smaller than the rest of the app",
      ).toMatch(new RegExp(`--text-${step}:`));
    }
  });

  it("is strictly larger than the global ramp at every shared step", () => {
    for (const step of SHARED_STEPS) {
      const global = remStep(THEME, step);
      const audiobook = remStep(AUDIOBOOK, step);
      expect(
        audiobook,
        `--text-${step} is ${audiobook}rem in .audiobook-theme and ${global}rem ` +
          "globally. The whole point of the override is that it is bigger.",
      ).toBeGreaterThan(global);
    }
  });

  it("keeps the ramp ascending, so the screen's own hierarchy survives", () => {
    // Every step moved up by the same amount. If one of them is retuned
    // alone, two sizes collapse into each other and a panel that used
    // text-micro for a hint and text-mini for its label stops distinguishing
    // them.
    const ladder = ["2xs", "micro", "mini", "xs", "sm"].map(s => remStep(AUDIOBOOK, s));
    for (let i = 1; i < ladder.length; i++) {
      expect(
        ladder[i],
        `the audiobook ramp is not ascending at step ${i}: ${ladder.join(" < ")}`,
      ).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it("does not move the writing app's steps as a side effect", () => {
    // The global values are what 1,447 call sites outside features/audiobook
    // render at. This override must stay scoped.
    expect(remStep(THEME, "2xs")).toBeCloseTo(0.5625, 5);
    expect(remStep(THEME, "micro")).toBeCloseTo(0.625, 5);
    expect(remStep(THEME, "mini")).toBeCloseTo(0.6875, 5);
  });
});
