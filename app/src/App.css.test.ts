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
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes("/audiobook/")) continue;
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
