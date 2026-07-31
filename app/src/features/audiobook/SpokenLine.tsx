// features/audiobook/SpokenLine.tsx
// ==================================
// A line of text that gets READ ALOUD by the page: each word lights up
// in turn, as though a narrator were speaking it. The style is picked
// at RANDOM every time the screen opens, so the flourish never goes
// stale -- the same sentence arrives underlined one visit, rising the
// next, shimmering the one after.
//
// Rules this obeys:
//   - decoration only. The text is fully readable at every frame, and
//     the animation ENDS at the plain resting style.
//   - CSS keyframes only (App.css). No libraries, no timers, no
//     per-frame React work.
//   - prefers-reduced-motion gets the resting style with no motion.

import { useMemo } from "react";

/** The reading styles, one per visit. Each maps to a CSS class in
 * App.css; every one leaves the word legible the whole way through. */
export const READING_STYLES = [
  "stw-read-underline",   // an underline travels word by word
  "stw-read-bold",        // each word thickens and brightens as it lands
  "stw-read-color",       // a vivid emerald sweeps along the line
  "stw-read-sparkle",     // a soft shimmer passes over each word
  "stw-read-rise",        // words lift as they are spoken
] as const;

export type ReadingStyle = typeof READING_STYLES[number];

interface SpokenLineProps {
  text: string;
  /** Pin the style (tests, or a deliberate choice); random otherwise. */
  style?: ReadingStyle;
  /** Seconds between words. */
  pace?: number;
  className?: string;
}

export function SpokenLine({ text, style, pace = 0.11, className = "" }: SpokenLineProps) {
  // Chosen once per mount: the flourish should not re-roll on every
  // re-render, only when the screen is opened again.
  const chosen = useMemo<ReadingStyle>(
    () => style ?? READING_STYLES[Math.floor(Math.random() * READING_STYLES.length)],
    [style],
  );
  const words = useMemo(() => text.split(/(\s+)/), [text]);

  let spokenIndex = 0;
  return (
    <span className={className}>
      {words.map((chunk, i) => {
        if (/^\s+$/.test(chunk)) return <span key={i}>{chunk}</span>;
        const delay = spokenIndex * pace;
        spokenIndex += 1;
        return (
          <span
            key={i}
            className={`stw-read ${chosen}`}
            style={{ "--stw-delay": `${delay}s` } as React.CSSProperties}
          >
            {chunk}
          </span>
        );
      })}
    </span>
  );
}
