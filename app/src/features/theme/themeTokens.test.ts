// themeTokens.test.ts -- the editor knows about every colour the app has
// ========================================================================
// The custom theme editor lists tokens from a registry; the app renders from
// App.css. Two lists, and both failure directions are silent:
//
//   A token in App.css and NOT in the registry is unreachable in the editor.
//   A writer building a custom theme never sees it, so it keeps whatever the
//   shipped dark value was -- one stubborn indigo in the middle of their
//   palette, with no control anywhere that explains why.
//
//   A token in the registry and NOT in App.css is a control that does nothing.
//   It writes a custom property no rule reads.
//
// Neither raises an error, so this reads the real stylesheet.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEME_TOKEN_GROUPS, THEME_TOKENS, THEME_TOKEN_NAMES, ALPHA_TOKEN_NAMES,
  sanitizeCustomTheme,
} from "./themeTokens";

// Read from disk, not through Vite: `import.meta.glob(..., "?raw")` returns an
// EMPTY STRING for a stylesheet here, which would make every assertion below
// pass while checking nothing. App.css.test.ts learned this first.
const CSS = readFileSync(resolve(process.cwd(), "src/App.css"), "utf-8")
  .split("\r\n")
  .join("\n");

if (CSS.length < 1000) {
  throw new Error(`App.css read back as ${CSS.length} chars -- the read is broken`);
}

/** The `:root` (dark) block, comments stripped. */
function darkBlock(): string {
  const start = CSS.indexOf(":root {");
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("\n}", open);
  return CSS.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Every `--st-*` declaration in dark, as name to raw value. */
function declared(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of darkBlock().matchAll(/(--st-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

describe("the registry covers exactly the app's role tokens", () => {
  it("found the stylesheet's tokens at all", () => {
    // A regex that matched nothing would make both directions below pass.
    expect(declared().size).toBeGreaterThan(40);
    expect(THEME_TOKENS.length).toBeGreaterThan(40);
  });

  it("lists every token App.css declares", () => {
    const missing = [...declared().keys()]
      .filter(n => !THEME_TOKEN_NAMES.includes(n))
      .sort();
    expect(
      missing,
      "these are in App.css but not in themeTokens.ts, so a writer building a "
        + "custom theme has no control for them and they keep the shipped dark "
        + "value. Add them to a group with a plain-language label.",
    ).toEqual([]);
  });

  it("lists nothing App.css does not declare", () => {
    const css = declared();
    const orphaned = THEME_TOKEN_NAMES.filter(n => !css.has(n)).sort();
    expect(
      orphaned,
      "these are in themeTokens.ts but not in App.css, so the editor offers a "
        + "control that writes a custom property nothing reads.",
    ).toEqual([]);
  });

  it("names each token exactly once", () => {
    // A duplicate would render two controls writing the same property, and the
    // second would silently win.
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const n of THEME_TOKEN_NAMES) {
      if (seen.has(n)) dupes.push(n);
      seen.add(n);
    }
    expect(dupes).toEqual([]);
  });
});

describe("alpha is flagged wherever the stylesheet actually uses it", () => {
  it("marks every rgb(R G B / A) token, and only those", () => {
    const css = declared();
    const cssAlpha = [...css.entries()]
      .filter(([, v]) => v.startsWith("rgb"))
      .map(([k]) => k)
      .sort();

    expect(
      ALPHA_TOKEN_NAMES.slice().sort(),
      "the editor shows an alpha box for exactly the tokens written as "
        + "rgb(R G B / A). Missing one means a writer cannot set the "
        + "transparency that token needs -- and for the three inks, "
        + "transparency is how they stay readable on four different surfaces. "
        + "An extra one means an alpha box that gets written back as hex and "
        + "silently discarded.",
    ).toEqual(cssAlpha);
  });

  it("keeps the three inks translucent, since they composite onto surfaces", () => {
    for (const ink of ["--st-text-primary", "--st-text-muted", "--st-faint"]) {
      expect(ALPHA_TOKEN_NAMES, `${ink} needs an alpha control`).toContain(ink);
    }
  });
});

describe("the groups are usable as a screen", () => {
  it("uses the headings App.css groups by", () => {
    // Not a cosmetic check: the writer reads App.css comments when they go
    // looking, and the editor should use the same words.
    const titles = THEME_TOKEN_GROUPS.map(g => g.title);
    for (const expected of ["Surfaces", "Lines", "Accent", "Categorical", "Editor layers"]) {
      expect(titles, `no group titled ${expected}`).toContain(expected);
    }
  });

  it("gives every group a blurb and at least one token", () => {
    for (const g of THEME_TOKEN_GROUPS) {
      expect(g.tokens.length, `${g.title} is empty`).toBeGreaterThan(0);
      expect(g.blurb.length, `${g.title} has no blurb`).toBeGreaterThan(20);
    }
  });

  it("labels every token in the writer's words, not the token's", () => {
    for (const t of THEME_TOKENS) {
      expect(t.label.length, `${t.name} has no label`).toBeGreaterThan(3);
      // "--st-bg-raised" labelled "bg raised" teaches nothing.
      const stripped = t.name.replace("--st-", "").replace(/-/g, " ");
      expect(
        t.label.toLowerCase(),
        `${t.name}'s label just restates its name`,
      ).not.toBe(stripped);
    }
  });

  it("has no em dashes in any label or blurb (locked product rule)", () => {
    for (const g of THEME_TOKEN_GROUPS) {
      expect(g.blurb).not.toMatch(/[–—]/);
      for (const t of g.tokens) expect(t.label).not.toMatch(/[–—]/);
    }
  });

  it("measures the inks against a real surface token", () => {
    // contrastAgainst names another token; a typo would silently disable the
    // readability warning rather than fail.
    for (const t of THEME_TOKENS) {
      if (!t.contrastAgainst) continue;
      expect(
        THEME_TOKEN_NAMES,
        `${t.name} measures contrast against ${t.contrastAgainst}, which is not a token`,
      ).toContain(t.contrastAgainst);
    }
  });
});

describe("a stored theme is writer data, so it is sanitised on the way in", () => {
  it("keeps known tokens", () => {
    const t = sanitizeCustomTheme({ "--st-bg-panel": "#123456" });
    expect(t).toEqual({ "--st-bg-panel": "#123456" });
  });

  it("drops a token the app no longer has", () => {
    // An old settings.json outlives a retired token. Passing it through to
    // style.setProperty would litter the DOM with dead properties forever.
    expect(sanitizeCustomTheme({ "--st-gone": "#fff" })).toEqual({});
  });

  it("drops anything that is not a non-empty string", () => {
    expect(sanitizeCustomTheme({
      "--st-bg-panel": "",
      "--st-bg-primary": null,
      "--st-border": 42,
    })).toEqual({});
  });

  it("survives rubbish instead of throwing", () => {
    // This comes off the wire. A theme editor that crashed the app on a
    // hand-edited settings.json would be unrecoverable without a text editor.
    expect(sanitizeCustomTheme(null)).toEqual({});
    expect(sanitizeCustomTheme("nope")).toEqual({});
    expect(sanitizeCustomTheme(undefined)).toEqual({});
  });
});
