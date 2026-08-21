// components/Wordmark.tsx -- the writer's own logo, on either background
// ========================================================================
// app/public/storythreadstudio.png is CUSTOM ARTWORK: the script lettering,
// the quill, and the thread looping through the "d" were drawn for this app.
// It is not a placeholder and it is not the app's to replace.
//
// (It WAS replaced, briefly, with a drawn lockup during the icon pass. That
// was wrong -- recolouring a palette is not licence to redraw somebody's
// logo -- and it is recorded here so the next person does not repeat it.)
//
// THE PLATE IS GONE, AND IT TURNS OUT IT NEVER NEEDED TO BE THERE.
//
// The file has a fully transparent background: the corners are (0,0,0,0) and
// only about six per cent of it is opaque at all. The ink is navy rgb(7,15,30).
// The ivory strip existed for exactly one reason -- navy ink is invisible on a
// dark page -- and it solved that by putting a rectangle of daylight behind
// the logo, which on a charcoal dashboard read as a sheet of paper taped to
// the window.
//
// So instead: invert the INK, and only in dark mode.
//
//   filter: invert(1) flips RGB and leaves alpha alone. The transparent
//   background stays transparent; the navy becomes a warm cream (248,240,225)
//   that sits on the grey-blue panel like ink on a page rather than a pasted
//   picture. Every tonal detail survives, including the grey shading on the
//   feather -- which a flat tint or an alpha mask would have crushed to one
//   solid colour.
//
//   Light mode gets no filter at all. The artwork was drawn for a pale ground
//   and the warm paper theme is one.
//
// Driven off the theme rather than a prefers-color-scheme media query,
// because the theme here is a stored choice and does not follow the OS.

import { useTheme } from "../hooks/useTheme";

interface WordmarkProps {
  /** Caps how wide the artwork renders. Its own aspect ratio sets the height. */
  maxImageWidth?: number;
  className?: string;
}

export function Wordmark({ maxImageWidth = 460, className = "" }: WordmarkProps) {
  const [theme] = useTheme();

  return (
    <div className={`flex w-full items-center justify-center py-4 ${className}`}>
      <img
        src="/storythreadstudio.png"
        alt="Storythread Studio"
        data-testid="wordmark"
        style={{
          maxWidth: `${maxImageWidth}px`,
          width: "100%",
          height: "auto",
          // Dark mode only. In light mode the ink is already right.
          filter: theme === "dark" ? "invert(1)" : undefined,
        }}
        // Stop the browser's default image drag; clicking near the logo
        // should not start a drag-and-drop ghost.
        draggable={false}
      />
    </div>
  );
}
