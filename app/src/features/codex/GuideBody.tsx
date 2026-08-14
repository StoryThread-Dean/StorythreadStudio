// features/codex/GuideBody.tsx -- laying out an explanation so it gets read
// ==========================================================================
// The guides behind each "What's this?" are structured lines rather than
// paragraphs, and this renders them.
//
// The point is scannability. Written as prose, the list of kinds a group can
// hold -- the thing a writer is actually looking for -- ends up buried
// mid-sentence, and the whole answer reads as a wall to be skipped. Pulling
// each term to the front of its own line means the question "what can I put
// here?" is answered without reading anything.
//
// Emphasis is data, not markup guessed at by a renderer: a `term` leads its
// line, and *asterisks* mark a phrase mid-sentence. Two shapes, one styling
// decision, made here.

import type { GuideLine } from "./lexicon";

/** Split a string on *emphasis* and render the marked parts. */
function withEmphasis(text: string) {
  // Odd indices are the emphasised runs, because splitting on a capturing
  // group interleaves matches with the text between them.
  return text.split(/\*([^*]+)\*/g).map((part, i) =>
    i % 2 === 1
      ? <span key={i} className="font-medium text-violet-300">{part}</span>
      : <span key={i}>{part}</span>,
  );
}

export function GuideBody({ lines }: { lines: GuideLine[] }) {
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => (
        <p
          key={i}
          className={`text-[11px] leading-relaxed ${
            // A kind within the group sits under the lines above it, so the
            // list reads as a list rather than as more sentences.
            line.indent ? "pl-3 text-text-muted" : "text-text-muted"
          }`}
        >
          {line.term && (
            <span className="font-semibold text-violet-300">{line.term} </span>
          )}
          {withEmphasis(line.text)}
        </p>
      ))}
    </div>
  );
}
