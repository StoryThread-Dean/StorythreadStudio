// features/audiobook/DialogueWindow.tsx
// ======================================
// The work surface: the writer's own text, with the paragraph being
// decided highlighted in its speaker's colour, and the markers shown
// exactly as they will sit in the file.
//
// Showing the raw markers is the point, not a leak of implementation.
// A writer who watches [voice:Lara Croft] appear around their own line
// has learned the syntax without being taught it, and can hand-type it
// forever after. Hiding it behind a pretty rendering would make this
// screen the only place casting is possible.
//
// Read-only by design. The real editor is one keystroke behind this
// window; two live editors over one buffer is a caret-and-scroll war for
// no gain. Everything here changes through the character buttons.

import { useEffect, useRef } from "react";

import { castColor, castTextColor } from "./castColors";
import type { DialogueStop } from "./speakerScan";

interface DialogueWindowProps {
  /** The whole narration buffer. */
  content: string;
  /** The paragraph under decision, or null when the walk is finished. */
  stop: DialogueStop | null;
  castNames: string[];
  /** How much text to show around the stop, in characters. */
  context?: number;
}

const VOICE_TOKEN = /(\[voice:[^\]]*\]|\[\/voice\])/gi;
const OTHER_MARKER = /(\[(?:pause:[^\]]*|scene-break|chapter-break|\/?exclude|say:[^\]]*|\/say|pace:[^\]]*|\/pace)\])/gi;

/** Paint one run of text: cast markers in the speaker's colour, other
 *  markers dimmed so they read as machinery rather than prose. */
function paint(text: string, color: string, keyPrefix: string) {
  return text.split(VOICE_TOKEN).map((chunk, i) => {
    if (VOICE_TOKEN.test(chunk)) {
      VOICE_TOKEN.lastIndex = 0;
      return (
        <span key={`${keyPrefix}-v${i}`} style={{ color }} className="font-medium">
          {chunk}
        </span>
      );
    }
    VOICE_TOKEN.lastIndex = 0;
    return (
      <span key={`${keyPrefix}-t${i}`}>
        {chunk.split(OTHER_MARKER).map((piece, j) => {
          const isMarker = OTHER_MARKER.test(piece);
          OTHER_MARKER.lastIndex = 0;
          return isMarker
            ? <span key={j} className="text-zinc-600">{piece}</span>
            : <span key={j}>{piece}</span>;
        })}
      </span>
    );
  });
}

export function DialogueWindow({
  content, stop, castNames, context = 320,
}: DialogueWindowProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);

  // Keep the decided paragraph in view as the walk moves, without
  // yanking the window when nothing changed.
  useEffect(() => {
    if (markRef.current && scrollRef.current) {
      const box = scrollRef.current.getBoundingClientRect();
      const mark = markRef.current.getBoundingClientRect();
      if (mark.top < box.top || mark.bottom > box.bottom) {
        markRef.current.scrollIntoView({ block: "center" });
      }
    }
  }, [stop?.start]);

  if (!stop) {
    return (
      <div className="h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
        Every line of dialogue in this chapter has been decided. Move to
        another chapter, or close and press Save in the editor to keep the
        markers.
      </div>
    );
  }

  const speaker = stop.assigned;
  const color = speaker ? castColor(speaker, castNames) : "";
  const before = content.slice(Math.max(0, stop.start - context), stop.start);
  const after = content.slice(stop.end, stop.end + context);

  return (
    <div
      ref={scrollRef}
      aria-label="Dialogue"
      className="h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 font-serif text-[12px] leading-relaxed text-zinc-500"
    >
      <span className="whitespace-pre-wrap">{before}</span>
      <span
        ref={markRef}
        className="whitespace-pre-wrap rounded px-0.5"
        style={speaker
          ? { backgroundColor: `${color}26`, boxShadow: `inset 0 0 0 1px ${color}`,
              color: "#E4E4E7" }
          : { backgroundColor: "#3F3F4640", boxShadow: "inset 0 0 0 1px #52525B",
              color: "#E4E4E7" }}
      >
        {paint(stop.text, color || "#A1A1AA", "stop")}
      </span>
      <span className="whitespace-pre-wrap">{after}</span>
    </div>
  );
}

export { castColor, castTextColor };
