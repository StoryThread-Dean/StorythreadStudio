// features/audiobook/markers.ts
// ==============================
// Text helpers for the narration markers. The [Remove] toolbar button
// strips audio formatting from a span of text while keeping every word
// the writer wrote: standalone markers vanish, wrapping markers ([say],
// [exclude]) dissolve leaving their inner text in place.

/** Strip all audio markers from a piece of narration text. */
export function stripAudioMarkers(text: string): string {
  return text
    // Wrapping markers dissolve to their displayed inner text.
    .replace(/\[say:[^\]]*\]([\s\S]*?)\[\/say\]/gi, "$1")
    .replace(/\[exclude\]([\s\S]*?)\[\/exclude\]/gi, "$1")
    .replace(/\[pace:[^\]]*\]([\s\S]*?)\[\/pace\]/gi, "$1")
    // Standalone markers vanish entirely.
    .replace(/\[(?:pause\s*:[^\]]*|scene-break|chapter-break)\]/gi, "")
    // Orphaned halves of wrapping markers (unclosed edits) vanish too.
    .replace(/\[\/?(?:say(?::[^\]]*)?|exclude|pace(?::[^\]]*)?)\]/gi, "")
    // Tidy the blank lines the removed markers leave behind.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The paragraph (blank-line-delimited block) containing `position`.
 * Used when [Remove] is clicked with no selection: the marker under or
 * beside the caret is the obvious target.
 */
export function paragraphBoundsAt(text: string, position: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(position, text.length));
  const before = text.lastIndexOf("\n\n", Math.max(0, clamped - 1));
  const start = before === -1 ? 0 : before + 2;
  const after = text.indexOf("\n\n", clamped);
  const end = after === -1 ? text.length : after;
  return { start, end };
}
