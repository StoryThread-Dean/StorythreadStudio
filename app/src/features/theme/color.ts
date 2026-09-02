// features/theme/color.ts -- reading and writing the two colour shapes
// =====================================================================
// The app's role tokens come in exactly two written forms, and the custom
// theme has to round-trip both without changing which one a token uses:
//
//     #RRGGBB               45 of the 56 tokens
//     rgb(R G B / A)        11 of them, and the alpha is LOAD-BEARING
//
// The alpha ones are not a stylistic choice. `--st-faint` is white at 55% so
// it composites onto whatever surface it lands on -- panel, inset, hover tint --
// and stays in proportion on each. Flattening it to one opaque hex would pick
// one surface and be wrong on the other three. Same for the `-soft` fills,
// which are a tint OVER a card, and `--st-scrim`, which is the point.
//
// So the editor keeps the shape a token was born with: a hex box for every
// token, plus an alpha box for the eleven, and what gets written back is the
// form CSS already expected.
//
// WCAG maths lives here too, because the custom theme is the one place a writer
// can make their own text unreadable, and this whole line of work started with
// somebody unable to use the app because of contrast. A theme editor that lets
// you do that silently would be a regression dressed as a feature.

/** A colour with an alpha channel. `a` is 0-1; 1 means fully opaque. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Which written form a token uses. Preserved on round trip. */
export type ColorShape = "hex" | "rgba";


// -- Parsing -----------------------------------------------------------------

/** Clamp to a whole 0-255 channel. */
function channel(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Clamp to 0-1 with two decimals, which is all the CSS values ever use. */
export function clampAlpha(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
}

/**
 * Parse `#RGB`, `#RRGGBB`, `#RRGGBBAA` or `rgb(R G B / A)`.
 *
 * Returns null rather than throwing or guessing. A theme editor that
 * substituted black for a typo would repaint the app while the writer was
 * still mid-keystroke, so every caller here treats null as "keep what you had".
 */
export function parseColor(input: string): Rgba | null {
  const s = input.trim();
  if (!s) return null;

  // rgb(R G B / A) -- the space-separated modern syntax App.css uses. Commas
  // and a missing alpha are both accepted, because a writer pasting from
  // anywhere else will produce them.
  const fn = s.match(
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/i,
  );
  if (fn) {
    const rawAlpha = fn[4];
    let a = 1;
    if (rawAlpha !== undefined) {
      a = rawAlpha.endsWith("%")
        ? Number(rawAlpha.slice(0, -1)) / 100
        : Number(rawAlpha);
    }
    if (!Number.isFinite(a)) return null;
    return {
      r: channel(Number(fn[1])),
      g: channel(Number(fn[2])),
      b: channel(Number(fn[3])),
      a: clampAlpha(a),
    };
  }

  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!hex) return null;
  let h = hex[1];
  // #RGB is shorthand for #RRGGBB. Writers type it; browsers accept it.
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a: clampAlpha(a) };
}


// -- Formatting --------------------------------------------------------------

/** `#RRGGBB`, upper case, alpha discarded. What the hex box and swatch show. */
export function toHex(c: Rgba): string {
  const p = (v: number) => channel(v).toString(16).padStart(2, "0").toUpperCase();
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

/**
 * Write a colour back in the shape its token expects.
 *
 * Keeping the shape matters for more than tidiness: `App.css.test.ts` parses
 * the surface tokens as SIX-DIGIT HEX ONLY and fails outright on anything
 * else, so a token that arrived as hex must leave as hex.
 */
export function formatColor(c: Rgba, shape: ColorShape): string {
  if (shape === "hex") return toHex(c);
  return `rgb(${channel(c.r)} ${channel(c.g)} ${channel(c.b)} / ${clampAlpha(c.a)})`;
}


// -- HSL, for the wheel ------------------------------------------------------

export interface Hsl {
  /** 0-360 degrees around the wheel. */
  h: number;
  /** 0-100 percent, centre to rim. */
  s: number;
  /** 0-100 percent, from the lightness slider. */
  l: number;
}

export function hslToRgb({ h, s, l }: Hsl): Rgba {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;

  // The standard conversion: chroma, an intermediate x, and a lightness match.
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  const [r1, g1, b1] =
    hh < 60  ? [c, x, 0] :
    hh < 120 ? [x, c, 0] :
    hh < 180 ? [0, c, x] :
    hh < 240 ? [0, x, c] :
    hh < 300 ? [x, 0, c] :
               [c, 0, x];

  return {
    r: channel((r1 + m) * 255),
    g: channel((g1 + m) * 255),
    b: channel((b1 + m) * 255),
    a: 1,
  };
}

export function rgbToHsl(c: Rgba): Hsl {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (d !== 0) {
    if (max === r)      h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else                h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;

  // Guard the divisor: pure black and pure white have no saturation and would
  // otherwise divide by zero here.
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  return {
    h: Math.round(h),
    s: Math.round(Math.max(0, Math.min(1, s)) * 100),
    l: Math.round(l * 100),
  };
}


// -- Contrast ----------------------------------------------------------------

/** Composite a translucent colour onto an opaque one -- what the eye sees. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/** WCAG 2.x relative luminance. The 0.03928 knee is part of the spec. */
export function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * Contrast ratio between two colours, 1 to 21.
 *
 * `fg` is composited onto `bg` first, so a translucent ink is measured as it
 * actually renders rather than as its raw channels.
 */
export function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG AA for normal-size text. The app's small text is well under 18.66px. */
export const AA_NORMAL = 4.5;

/**
 * Is this palette a light one?
 *
 * Used to set `color-scheme` on a custom theme, which is what makes native
 * scrollbars, <select> popups and context menus follow it. Those are drawn by
 * the OS outside the page, so no amount of CSS reaches them -- getting this
 * wrong leaves dark scrollbars on a cream custom theme, which is the exact
 * bug light mode shipped with before v2.0.2.
 */
export function isLightPalette(background: Rgba): boolean {
  return luminance(background) > 0.5;
}
