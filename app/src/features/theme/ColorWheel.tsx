// features/theme/ColorWheel.tsx -- the pinwheel, and no dependency for it
// =========================================================================
// A hue/saturation wheel plus a lightness slider, built from two CSS
// gradients and some trigonometry.
//
// WHY NOT A LIBRARY. This app ships as a Tauri bundle with no colour-picker
// dependency, and adding one for a single screen would put a package in the
// build for a control that is ninety lines of maths. The two gradients do the
// drawing; the click handler does the reading.
//
// HOW THE WHEEL IS DRAWN, since it looks like magic:
//   conic-gradient  paints hue around the circle, red at the top, going
//                   clockwise through the spectrum and back to red.
//   radial-gradient paints white in the middle fading to transparent at the
//                   rim, which is saturation: the centre is colourless and
//                   the edge is full strength.
// Stacked, that is a standard colour wheel. Lightness is NOT on the wheel,
// because a wheel can only carry two axes -- it gets its own slider, which is
// also the axis a writer adjusts most when building a theme (the same hue at
// two lightnesses is what a surface ramp IS).
//
// WHY THE OS PICKER IS ALSO OFFERED, on every row in the editor. <input
// type="color"> opens the native dialog, which has an eyedropper on Windows --
// a writer matching a colour from a screenshot needs that, and no amount of
// wheel replaces it. The wheel is for exploring; the eyedropper is for
// matching; the hex box is for pasting. All three, because they are three
// different jobs.

import { useCallback, useRef } from "react";
import {
  type Rgba, type Hsl, hslToRgb, rgbToHsl, toHex,
} from "./color";


/** How big the wheel is drawn, in px. Kept fixed so the maths stays simple. */
const WHEEL_PX = 208;

export function ColorWheel({
  /** The colour the wheel is currently showing. */
  value,
  /** Called with a fully opaque colour whenever the writer picks. */
  onPick,
}: {
  value: Rgba;
  onPick: (next: Rgba) => void;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const hsl: Hsl = rgbToHsl(value);

  /**
   * Turn a click into a hue and a saturation.
   *
   * Angle around the centre is hue; distance from the centre is saturation,
   * clamped at the rim so a click just outside the circle still reads as
   * "fully saturated" rather than doing nothing. Lightness is left alone --
   * the writer is choosing a hue here, not re-picking a brightness they
   * already set on the slider.
   */
  const pickFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    // atan2 gives radians from the positive x-axis counter-clockwise. The
    // conic-gradient starts at the TOP and runs clockwise, so rotate by 90
    // degrees to line the maths up with what is drawn. Getting this wrong
    // produces a picker that returns a colour 90 degrees from the one under
    // the pointer, which looks like a broken wheel rather than a bad rotation.
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const hue = ((deg % 360) + 360) % 360;

    const radius = Math.min(rect.width, rect.height) / 2;
    const sat = Math.min(1, Math.hypot(dx, dy) / radius) * 100;

    onPick(hslToRgb({ h: hue, s: sat, l: hsl.l }));
  }, [hsl.l, onPick]);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* The wheel. A button rather than a div so it is keyboard-focusable and
          announced; the arrow keys below give it a real keyboard path, because
          a control you can only use with a mouse is not a control everyone
          has. */}
      <div
        ref={wheelRef}
        role="button"
        tabIndex={0}
        aria-label="Colour wheel: click to choose a hue and saturation"
        onClick={e => pickFromPoint(e.clientX, e.clientY)}
        onPointerMove={e => {
          // Drag to sweep. `buttons` rather than a dragging flag: it is the
          // browser's own answer to "is a button held", and it stays right
          // when the pointer leaves and re-enters mid-drag.
          if (e.buttons === 1) pickFromPoint(e.clientX, e.clientY);
        }}
        onKeyDown={e => {
          const step = e.shiftKey ? 15 : 3;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const dir = e.key === "ArrowRight" ? 1 : -1;
            onPick(hslToRgb({ ...hsl, h: hsl.h + dir * step }));
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const dir = e.key === "ArrowUp" ? 1 : -1;
            onPick(hslToRgb({ ...hsl, s: Math.max(0, Math.min(100, hsl.s + dir * step)) }));
          }
        }}
        style={{
          width: WHEEL_PX,
          height: WHEEL_PX,
          borderRadius: "50%",
          cursor: "crosshair",
          // Hue around, saturation outward. The white centre goes on TOP of
          // the hue ring, which is why it is listed first.
          backgroundImage:
            "radial-gradient(circle at center, #fff 0%, rgba(255,255,255,0) 70%), "
            + "conic-gradient(from 0deg, "
            + "#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          // A ring rather than a border, so the wheel's edge does not read as
          // part of the spectrum.
          boxShadow: "0 0 0 1px var(--st-border-strong)",
        }}
      />

      {/* Lightness. Its track is painted with the CURRENT hue so the writer
          can see what the slider is about to give them, which a plain grey
          track cannot show. */}
      <label className="w-full">
        <span className="mb-1 block text-mini text-text-muted">
          Lightness {hsl.l}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={hsl.l}
          aria-label="Lightness"
          onChange={e => onPick(hslToRgb({ ...hsl, l: Number(e.target.value) }))}
          className="w-full"
          style={{
            background: `linear-gradient(to right, #000, hsl(${hsl.h} ${hsl.s}% 50%), #fff)`,
            borderRadius: "4px",
            height: "10px",
            appearance: "none",
          }}
        />
      </label>

      {/* What the wheel currently holds, big enough to judge, with the hex
          selectable so it can be copied out. */}
      <div className="w-full">
        <div
          className="mb-2 h-12 w-full rounded border border-border"
          style={{ background: toHex(value) }}
          aria-hidden
        />
        <div className="flex items-center gap-2">
          <span className="text-mini text-text-muted">HexCode:</span>
          <code
            className="flex-1 select-all rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary"
            data-testid="wheel-hex"
          >
            {toHex(value)}
          </code>
        </div>
      </div>
    </div>
  );
}
