// components/Wordmark.tsx -- Storythread Studio Dashboard Wordmark
// =================================================================
// Renders the official Storythread Studio logo as a wide banner across
// the top of the ProjectHome dashboard.
//
// Asset: app/public/storythreadstudio.png
//   Vite serves anything in app/public/ at the site root, so this loads as
//   /storythreadstudio.png. Replace that file to swap the artwork; no code
//   change needed.
//
// About the layout:
//   The logo is a wide horizontal mark (cursive "Storythread" + Studio +
//   quill glyph). To read as a banner rather than a boxed thumbnail it
//   needs to stretch across the panel with minimal vertical padding -- the
//   logo's natural aspect ratio carries the banner shape on its own.
//
//   The artwork is dark indigo on near-white. To stay visible in dark mode
//   (where the panel is dark navy) the banner sits on an ivory strip that
//   spans the full width in both themes. In light mode the strip blends
//   gracefully into the surrounding paper palette; in dark mode it stands
//   out as a deliberate "frontispiece" band, the way a book cover detail
//   sits on a printed dust jacket.

interface WordmarkProps {
  /** Max width the logo image is allowed to render at. The banner strip
   *  itself is full-width; this just caps the image so it doesn't bloom
   *  oversized on very wide windows. */
  maxImageWidth?: number;
  /** Optional className applied to the outer banner. */
  className?: string;
}


export function Wordmark({ maxImageWidth = 520, className = "" }: WordmarkProps) {
  return (
    // Full-width ivory strip with NO vertical padding -- the image's own
    // aspect ratio sets the banner height. Any padding here just adds
    // wasted landscape above and below the artwork.
    <div
      className={`flex w-full items-center justify-center bg-paper ${className}`}
    >
      <img
        src="/storythreadstudio.png"
        alt="Storythread Studio"
        style={{ maxWidth: `${maxImageWidth}px`, width: "100%", height: "auto" }}
        // Stop the browser's default image-drag behavior; clicking near the
        // logo shouldn't kick off a drag-and-drop ghost image.
        draggable={false}
      />
    </div>
  );
}
