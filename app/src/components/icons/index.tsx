// components/icons/index.tsx -- the app's own marks
// ==================================================
// Storythread Studio is named for thread. Until now it borrowed a generic
// icon set for everything, including the things that ARE the product: the
// brand, the Weave, a secret held back. These are drawn for those.
//
// ORIGINAL WORK, in the visual language of the reference images the writer
// supplied (a needle and thread, a floor loom, a running stitch, a set of
// sewing line icons). Those references are watermarked stock comps and are
// not shippable; they set the direction and nothing else.
//
// THEY MATCH LUCIDE'S CONTRACT EXACTLY -- 24x24 viewBox, fill none, stroke
// currentColor, width 2, round caps and joins -- for a practical reason
// rather than a tidy one: every icon in this app is tinted by having a text
// colour applied to it (see TONE_CLASSES), and sized by a `size` prop. Match
// the contract and these drop into those call sites unchanged. Break it and
// each one needs a special case.
//
// KEPT DELIBERATELY SPARSE. These are read at 11 to 18 pixels. Every line
// below survives being drawn three millimetres tall; anything finer became a
// grey smudge and was removed rather than kept for the look of it in source.

import type { LucideIcon } from "lucide-react";
import type { FC } from "react";

export interface IconProps {
  size?: number | string;
  className?: string;
  strokeWidth?: number;
}

/**
 * Either kind of icon.
 *
 * lucide's components are a nominal type, so a plain FC does not satisfy
 * `LucideIcon` even when it renders identically. Registries that hold icons
 * -- lexicon.ts, sectionRegistry -- widen to this so they can hold both.
 */
export type AppIcon = LucideIcon | FC<IconProps>;

/** Shared wrapper, so the contract is written once. */
function Mark({
  size = 24, className, strokeWidth = 2, children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * The brand mark: a needle drawn through, with the thread still moving.
 *
 * A needle at rest is a sewing icon. A needle mid-stitch with thread trailing
 * is the app -- something being made, not a tool in a drawer.
 */
export const NeedleThread: FC<IconProps> = props => (
  <Mark {...props}>
    <path d="M3 21 14.2 9.8" />
    <circle cx="17" cy="7" r="3" />
    <path d="M14.6 5.3C10 3 5.5 6.5 8 10.4" />
  </Mark>
);

/**
 * A running stitch: the simplest stitch there is, and the one that reads at
 * any size. Used as the divider motif as well as an icon -- see StitchRule.
 */
export const RunningStitch: FC<IconProps> = props => (
  <Mark {...props}>
    <path d="M2 12h3.5M9 12h3.5M16 12h3.5M22.5 12H23" />
  </Mark>
);

/**
 * A floor loom: two posts, two beams, and the warp strung between them.
 *
 * The Weave's own mark. It was borrowing a network graph icon, which is what
 * the FEATURE is underneath but not what the writer is doing with it.
 */
export const Loom: FC<IconProps> = props => (
  <Mark {...props}>
    <path d="M4 3v18M20 3v18" />
    <path d="M2 7h20M2 18h20" />
    <path d="M9 7v11M15 7v11" />
  </Mark>
);

/** A spool of thread, wound. */
export const SpoolMark: FC<IconProps> = props => (
  <Mark {...props}>
    <path d="M7 3h10M7 21h10" />
    <path d="M9 3v18M15 3v18" />
    <path d="M9 8h6M9 12h6M9 16h6" />
  </Mark>
);

/**
 * A thimble: the thing you put on to keep something from going through.
 *
 * For a secret -- a trait marked as subtext, a section held back. Protection
 * rather than prohibition, which is the right register: there is nothing
 * wrong with a secret, it simply is not for saying out loud.
 */
export const Thimble: FC<IconProps> = props => (
  <Mark {...props}>
    <path d="M6 21v-9a6 6 0 0 1 12 0v9Z" />
    <path d="M6 17.5h12" />
    <path d="M10 9h.01M14 9h.01M12 12h.01" />
  </Mark>
);

/** Warp and weft crossing: cloth, at the smallest size cloth can be drawn. */
export const WarpWeft: FC<IconProps> = props => (
  <Mark {...props}>
    <path d="M3 9h18M3 15h18" />
    <path d="M9 3v18M15 3v18" />
  </Mark>
);

/**
 * A pin, with two stitches behind it.
 *
 * For "appears here" -- a thing marked as present at a point in the book.
 * A map pin says PLACE, which is wrong for a chapter.
 */
export const PinStitch: FC<IconProps> = props => (
  <Mark {...props}>
    <circle cx="18" cy="6" r="2.5" />
    <path d="M16.2 7.8 6 18" />
    <path d="M4 21h.01M7.5 20h.01" />
  </Mark>
);

/**
 * A horizontal rule as a line of stitching.
 *
 * Not an icon -- a divider, stretched to whatever width it is given. The app
 * separates things with `h-px bg-border`, which is a hairline and says
 * nothing. This says the same thing in the app's own vocabulary and costs the
 * same single element.
 *
 * `currentColor` and a dash pattern, so it tints and scales like text.
 */
export function StitchRule({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-[6px] w-full text-border ${className}`}
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M0 3H100" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
