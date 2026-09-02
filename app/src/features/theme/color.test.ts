// color.test.ts -- the two shapes, and the maths under the wheel
// ===============================================================
// The custom theme is the one place a writer's own text can be written into
// the app's stylesheet, so the round trip has to be exact in both directions:
// a token born as `#RRGGBB` must leave as `#RRGGBB` (App.css.test.ts parses
// the surface tokens as six-digit hex ONLY and fails outright on anything
// else), and a token born as `rgb(R G B / A)` must keep its alpha, because
// alpha is how the three inks stay readable on four different surfaces.

import { describe, it, expect } from "vitest";
import {
  parseColor, toHex, formatColor, hslToRgb, rgbToHsl,
  contrast, over, luminance, isLightPalette, clampAlpha, AA_NORMAL,
} from "./color";

describe("parsing the shapes App.css actually uses", () => {
  it("reads #RRGGBB", () => {
    expect(parseColor("#1E1E1E")).toEqual({ r: 30, g: 30, b: 30, a: 1 });
  });

  it("reads rgb(R G B / A), the space-separated form the stylesheet uses", () => {
    expect(parseColor("rgb(255 255 255 / 0.55)"))
      .toEqual({ r: 255, g: 255, b: 255, a: 0.55 });
  });

  it("reads the forms a writer will paste from elsewhere", () => {
    // #RGB shorthand, commas, rgba(), a percentage alpha, and stray spaces.
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("  #FFFFFF  ")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgb(0 0 0 / 50%)")?.a).toBe(0.5);
  });

  it("reads 8-digit hex as colour plus alpha", () => {
    const c = parseColor("#FFFFFF8C");
    expect(c?.r).toBe(255);
    expect(c?.a).toBeCloseTo(0.55, 2);
  });

  it("returns null for anything it cannot read, rather than guessing", () => {
    // THIS IS THE IMPORTANT ONE. The hex box applies on every keystroke, so a
    // half-typed "#12" is parsed constantly. Guessing black there would
    // repaint the app mid-keystroke; null means "keep what you had".
    for (const bad of ["", "#12", "#12345", "nope", "rgb(1 2)", "#GGGGGG", "  "]) {
      expect(parseColor(bad), `${bad} should not parse`).toBeNull();
    }
  });
});

describe("writing a colour back in its own shape", () => {
  it("keeps a hex token hex", () => {
    const c = parseColor("#23232D")!;
    expect(formatColor(c, "hex")).toBe("#23232D");
  });

  it("keeps an alpha token in rgb(R G B / A)", () => {
    const c = parseColor("rgb(255 255 255 / 0.72)")!;
    expect(formatColor(c, "rgba")).toBe("rgb(255 255 255 / 0.72)");
  });

  it("round-trips every shipped value unchanged", () => {
    // The values below are copied from App.css. If formatting ever normalises
    // them differently, a writer who opens the editor and saves without
    // touching anything would rewrite their whole palette.
    for (const hex of ["#1E1E1E", "#23232D", "#33333D", "#FBF8F1", "#070724"]) {
      expect(formatColor(parseColor(hex)!, "hex")).toBe(hex);
    }
    for (const rgba of [
      "rgb(0 0 0 / 0.66)",
      "rgb(255 255 255 / 0.92)",
      "rgb(144 202 249 / 0.14)",
      "rgb(255 255 255 / 0.04)",
    ]) {
      expect(formatColor(parseColor(rgba)!, "rgba")).toBe(rgba);
    }
  });

  it("upper-cases hex and drops alpha from it", () => {
    expect(toHex({ r: 30, g: 30, b: 30, a: 0.5 })).toBe("#1E1E1E");
    expect(toHex(parseColor("#abcdef")!)).toBe("#ABCDEF");
  });

  it("clamps alpha into range and to two decimals", () => {
    expect(clampAlpha(1.7)).toBe(1);
    expect(clampAlpha(-2)).toBe(0);
    expect(clampAlpha(0.5551)).toBe(0.56);
    // NaN is "the writer typed something that is not a number". Opaque is the
    // least destructive answer -- it never makes a colour invisible.
    expect(clampAlpha(NaN)).toBe(1);
  });
});

describe("HSL, which is what the wheel speaks", () => {
  it("round-trips a colour through HSL and back", () => {
    for (const hex of ["#90CAF9", "#E57373", "#FFD54F", "#4FC3F7", "#7E57C2"]) {
      const rgb = parseColor(hex)!;
      const back = hslToRgb(rgbToHsl(rgb));
      // Within one channel step: HSL is rounded to whole degrees and percents
      // for the readouts, so exact equality is not the contract.
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(2);
    }
  });

  it("handles the greys, where saturation has no defined hue", () => {
    // Pure black and white would divide by zero in the naive conversion.
    expect(() => rgbToHsl({ r: 0, g: 0, b: 0, a: 1 })).not.toThrow();
    expect(rgbToHsl({ r: 0, g: 0, b: 0, a: 1 }).s).toBe(0);
    expect(rgbToHsl({ r: 255, g: 255, b: 255, a: 1 }).s).toBe(0);
    expect(rgbToHsl({ r: 128, g: 128, b: 128, a: 1 }).s).toBe(0);
  });

  it("puts the primaries where the wheel draws them", () => {
    // The conic-gradient starts red at the top and runs clockwise. If these
    // drift, the wheel returns a colour that is not the one under the pointer.
    expect(rgbToHsl(parseColor("#FF0000")!).h).toBe(0);
    expect(rgbToHsl(parseColor("#00FF00")!).h).toBe(120);
    expect(rgbToHsl(parseColor("#0000FF")!).h).toBe(240);
  });

  it("wraps a hue past the end of the wheel instead of clamping", () => {
    // Arrow-key nudging walks past 360 and below 0.
    expect(hslToRgb({ h: 360, s: 100, l: 50 })).toEqual(hslToRgb({ h: 0, s: 100, l: 50 }));
    expect(hslToRgb({ h: -10, s: 100, l: 50 })).toEqual(hslToRgb({ h: 350, s: 100, l: 50 }));
  });
});

describe("contrast, which is what stops this feature undoing the last one", () => {
  it("gets the reference values right", () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrast(white, black)).toBeCloseTo(21, 1);
    expect(contrast(white, white)).toBeCloseTo(1, 2);
  });

  it("measures a translucent ink as it actually renders", () => {
    // --st-faint is white at 55%. Measured raw it would look like 21:1
    // against a dark panel; composited it is about 5.7, which is the number
    // that matters. This is the whole reason `over` exists.
    const faint = parseColor("rgb(255 255 255 / 0.55)")!;
    const panel = parseColor("#23232D")!;
    expect(contrast(faint, panel)).toBeGreaterThan(5);
    expect(contrast(faint, panel)).toBeLessThan(6.5);
  });

  it("agrees with the shipped themes' measured figures", () => {
    // These are the numbers recorded in App.css and docs/appearance-spec.md.
    // If this maths drifts, the editor's warnings stop matching the values the
    // build gate enforces, and one of the two would be lying.
    const darkPanel = parseColor("#23232D")!;
    expect(contrast(parseColor("rgb(255 255 255 / 0.92)")!, darkPanel)).toBeCloseTo(13.34, 1);
    expect(contrast(parseColor("rgb(255 255 255 / 0.72)")!, darkPanel)).toBeCloseTo(8.70, 1);

    const lightPanel = parseColor("#FBF9F4")!;
    expect(contrast(parseColor("rgb(26 26 26 / 0.64)")!, lightPanel)).toBeCloseTo(5.12, 1);
  });

  it("keeps the AA floor at the normal-text threshold", () => {
    // Not 3.0. The app's small text is 9-12px, far below the 18.66px that
    // would justify the large-text exemption.
    expect(AA_NORMAL).toBe(4.5);
  });

  it("composites correctly at the extremes", () => {
    const bg = { r: 0, g: 0, b: 0, a: 1 };
    expect(over({ r: 255, g: 255, b: 255, a: 1 }, bg).r).toBe(255);
    expect(over({ r: 255, g: 255, b: 255, a: 0 }, bg).r).toBe(0);
  });
});

describe("deciding whether a palette is light", () => {
  it("recognises the shipped backgrounds", () => {
    // This drives `color-scheme`, which is the only thing that reaches native
    // scrollbars and <select> popups -- they are drawn by the OS outside the
    // page, so getting it wrong leaves dark scrollbars on a cream theme.
    expect(isLightPalette(parseColor("#F5F2EC")!)).toBe(true);
    expect(isLightPalette(parseColor("#1E1E1E")!)).toBe(false);
    expect(isLightPalette(parseColor("#09090b")!)).toBe(false);
  });

  it("uses luminance rather than a channel average", () => {
    // Pure green is bright to the eye and mid-grey by channel average. A
    // naive average would call a saturated theme dark when it is not.
    expect(luminance(parseColor("#00FF00")!)).toBeGreaterThan(0.5);
    expect(isLightPalette(parseColor("#00FF00")!)).toBe(true);
  });
});
