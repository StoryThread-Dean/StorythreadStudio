// components/Wordmark.tsx -- the name, set rather than photographed
// ===================================================================
// This used to render app/public/storythreadstudio.png: dark indigo artwork
// on near-white, which meant it needed an ivory plate underneath to stay
// visible on a dark page. That plate was the app's last hardcoded colour, and
// on a charcoal dashboard it read as a sheet of paper taped to the window.
//
// So the mark is drawn and the name is set as text. Three things follow, and
// they are why this is worth doing rather than commissioning a nicer picture:
//
//   IT IS THEME-AWARE. Everything here is currentColor and role tokens, so
//   the wordmark is dark on paper and light on charcoal with no second asset
//   and no plate to hide the mismatch.
//
//   IT IS SHARP AT ANY SIZE. A raster fixed at one width is either soft or
//   oversized on somebody else's display.
//
//   IT SCALES WITH THE WRITER'S SETTINGS, because it is type. A raster
//   ignores Interface size exactly the way 847 pixel font sizes used to.
//
// Set in the system serif rather than an embedded face: a webfont for one
// word is a real download on every launch, and this app runs offline.

import { NeedleThread } from "./icons";

interface WordmarkProps {
  /** Smaller variant, for a title bar rather than a dashboard band. */
  compact?: boolean;
  className?: string;
}

export function Wordmark({ compact = false, className = "" }: WordmarkProps) {
  return (
    <div
      className={`flex items-center justify-center gap-3 ${compact ? "py-2" : "py-5"} ${className}`}
    >
      <NeedleThread
        size={compact ? 22 : 34}
        className="shrink-0 text-accent"
        strokeWidth={1.75}
      />
      <span className="flex items-baseline gap-2">
        <span
          className={`font-serif tracking-tight text-text-primary ${
            compact ? "text-lg" : "text-2xl"
          }`}
        >
          Storythread
        </span>
        <span
          className={`uppercase tracking-label text-text-muted ${
            compact ? "text-micro" : "text-xs"
          }`}
        >
          Studio
        </span>
      </span>
    </div>
  );
}
