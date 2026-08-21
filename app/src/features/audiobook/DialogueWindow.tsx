// features/audiobook/DialogueWindow.tsx
// ======================================
// The work surface: the writer's own text, with the paragraph being
// decided called out and the markers shown exactly as they will sit in
// the file.
//
// Showing the raw markers is the point, not a leak of implementation.
// A writer who watches [voice:Elizabeth Bennet] appear around their own
// line has learned the syntax without being taught it, and can hand-type
// it forever after.
//
// Read-only by design. The real editor is one keystroke behind this
// window; two live editors over one buffer is a caret-and-scroll war for
// no gain. Everything here changes through the character buttons.
//
// The highlight rule matters more than it looks. An unassigned paragraph
// is washed grey as a whole -- the question is "who says this
// paragraph". Once a speaker is chosen, only the SPOKEN WORDS carry
// their colour: "I could easily forgive his pride," she said, "if he had
// not mortified mine." The tag in the middle is the narrator's, and
// colouring it would tell the writer their narrator had changed voice.

import { useEffect, useRef } from "react";

import type { DialogueStop } from "./speakerScan";

interface DialogueWindowProps {
  /** The whole narration buffer. */
  content: string;
  /** The paragraph under decision, or null when the walk is finished. */
  stop: DialogueStop | null;
  /** A character's colour, looked up by name. */
  colorOf: (name: string) => string;
  /** How much text to show around the stop, in characters. */
  context?: number;
}

const VOICE_SPAN = /\[voice:[^\]]*\][\s\S]*?\[\/voice\]/gi;
const VOICE_TOKEN = /(\[voice:[^\]]*\]|\[\/voice\])/gi;
const OTHER_MARKER = /(\[(?:pause:[^\]]*|scene-break|chapter-break|\/?exclude|say:[^\]]*|\/say|pace:[^\]]*|\/pace)\])/gi;

/** Narration: markers dimmed so they read as machinery, prose plain. */
function plain(text: string, keyPrefix: string) {
  return text.split(OTHER_MARKER).map((piece, i) => {
    const isMarker = OTHER_MARKER.test(piece);
    OTHER_MARKER.lastIndex = 0;
    return isMarker
      ? <span key={`${keyPrefix}-m${i}`} className="text-zinc-600">{piece}</span>
      : <span key={`${keyPrefix}-p${i}`}>{piece}</span>;
  });
}

/** One [voice:...]...[/voice] span: the tags in the character's colour,
 *  the words inside carrying it as a highlight. */
function spoken(span: string, color: string, keyPrefix: string) {
  return span.split(VOICE_TOKEN).map((chunk, i) => {
    const isTag = VOICE_TOKEN.test(chunk);
    VOICE_TOKEN.lastIndex = 0;
    if (isTag) {
      return (
        <span key={`${keyPrefix}-t${i}`} style={{ color }} className="font-medium">
          {chunk}
        </span>
      );
    }
    return (
      <span
        key={`${keyPrefix}-s${i}`}
        className="rounded px-0.5"
        style={{ backgroundColor: `${color}40`, color: "#F4F4F5" }}
      >
        {plain(chunk, `${keyPrefix}-s${i}`)}
      </span>
    );
  });
}

export function DialogueWindow({
  content, stop, colorOf, context = 320,
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
      <div className="h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs leading-relaxed text-zinc-500">
        Every line of dialogue in this chapter has been decided. Move to
        another chapter, or close and press Save in the editor to keep the
        markers.
      </div>
    );
  }

  const speaker = stop.assigned;
  const color = speaker ? colorOf(speaker) : "";
  const before = content.slice(Math.max(0, stop.start - context), stop.start);
  const after = content.slice(stop.end, stop.end + context);

  // Assigned: a slim bar in the speaker's colour says WHICH paragraph,
  // and the spoken words carry the colour. Unassigned: the whole
  // paragraph is washed, because the whole paragraph is the question.
  const body = speaker
    ? stop.text.split(VOICE_SPAN).flatMap((run, i, all) => {
        const spans = stop.text.match(VOICE_SPAN) ?? [];
        const out = [<span key={`n${i}`}>{plain(run, `n${i}`)}</span>];
        if (i < all.length - 1 && spans[i]) {
          out.push(<span key={`v${i}`}>{spoken(spans[i], color, `v${i}`)}</span>);
        }
        return out;
      })
    : plain(stop.text, "stop");

  return (
    <div
      ref={scrollRef}
      aria-label="Dialogue"
      className="h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 font-serif text-xs leading-relaxed text-zinc-500"
    >
      <span className="whitespace-pre-wrap">{before}</span>
      <span
        ref={markRef}
        data-assigned={speaker || undefined}
        className={"whitespace-pre-wrap " + (speaker ? "pl-1.5" : "rounded px-0.5")}
        style={speaker
          ? { borderLeft: `2px solid ${color}`, color: "#D4D4D8" }
          : { backgroundColor: "#3F3F4640", boxShadow: "inset 0 0 0 1px #52525B",
              color: "#E4E4E7" }}
      >
        {body}
      </span>
      <span className="whitespace-pre-wrap">{after}</span>
    </div>
  );
}
