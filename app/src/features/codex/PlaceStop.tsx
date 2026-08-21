// features/codex/PlaceStop.tsx -- where does this appear?
// ========================================================
// The offer half of declared presence. Weaving reads the manuscript for free
// and can see that the prose puts Serena in chapters one to nine; this asks
// whether to record it.
//
// WHY THE WRITER WANTED THIS, which decides what the screen has to do:
//
//   "An epic adventure story may have 30-60 character profiles with dozens of
//    creatures, 20-40 locations. Having to check and uncheck what the writer
//    wants to attach as context can be tedious."
//
// So the payoff is not the tagging, it is what happens afterwards: the AI brief
// stops carrying the whole world and carries this chapter's part of it. The
// card has to SAY that, because tagging chapters is work and the reason to do
// it is invisible from here.
//
// ── IT OFFERS. IT DOES NOT DECIDE ───────────────────────────────────────────
//
// Every suggested chapter arrives ticked, because the scan found the entry's
// name in it and that is evidence rather than a guess -- but every tick is the
// writer's to remove before they accept, and nothing is written until they do.
// An offer they ignore leaves no trace at all.
//
// That is the line that keeps presence AUTHORED. R8.5 deleted `codex_mention`
// because presence derived from the manuscript and cached goes silently wrong
// the moment a chapter is edited, while the freshness gate reports the index
// current. Nothing here derives anything: it proposes, and the writer states.

import { useMemo, useState } from "react";
import { Check, Loader, MapPin } from "lucide-react";

import type { ChapterAnchor } from "./api";

interface Props {
  /** The entry being placed, as the walk shows it. */
  name: string;
  /** Chapters the prose puts it in, from the free scan. */
  found: string[];
  /** Chapters the writer has already recorded. */
  already: string[];
  /** The book, in reading order, for the ones the scan did not find. */
  chapters: ChapterAnchor[];
  busy?: boolean;
  onSave: (appearsIn: string[]) => void;
  onSkip: () => void;
}

export function PlaceStop({
  name, found, already, chapters, busy, onSave, onSkip,
}: Props) {
  // Ticked to start with: everything the writer already recorded, plus
  // everything the prose shows. The scan found the name there -- that is
  // evidence, and making them tick nine boxes to agree with their own book
  // would be the tedium this feature exists to remove.
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set([...already, ...found]));
  const [showAll, setShowAll] = useState(false);

  const suggested = useMemo(() => new Set(found), [found]);
  const recorded = useMemo(() => new Set(already), [already]);

  // The scan's chapters first, because those are the answer to the question.
  // The rest are there for a writer who knows their character is in a chapter
  // the prose never names them in -- present in a scene, never spoken to.
  const shown = showAll
    ? chapters
    : chapters.filter(c => suggested.has(c.anchor) || recorded.has(c.anchor));

  const toggle = (anchor: string) => setTicked(prev => {
    const next = new Set(prev);
    if (next.has(anchor)) next.delete(anchor);
    else next.add(anchor);
    return next;
  });

  return (
    <div className="mt-2 rounded border border-accent-soft/60 bg-accent-soft/15 px-2.5 py-2"
         data-testid="place-stop">
      <p className="flex items-center gap-1.5 text-mini font-medium text-accent-strong">
        <MapPin size={11} /> Where {name} appears
      </p>

      {/* THE PAYOFF, said plainly. Tagging chapters is work and the reason for
          it happens somewhere else entirely. */}
      <p className="mt-1 text-micro text-faint">
        Recording this lets the app send only what belongs in the chapter you
        are writing, instead of your whole world every time. Nothing is saved
        until you press the button.
      </p>

      <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto"
          data-testid="place-chapters">
        {shown.map(chapter => (
          <li key={chapter.anchor}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-mini hover:bg-white/5">
              <input
                type="checkbox"
                checked={ticked.has(chapter.anchor)}
                onChange={() => toggle(chapter.anchor)}
              />
              <span className="truncate text-text-primary">{chapter.title}</span>
              {recorded.has(chapter.anchor) && (
                <span className="ml-auto shrink-0 text-2xs text-faint">
                  already recorded
                </span>
              )}
              {!recorded.has(chapter.anchor) && suggested.has(chapter.anchor) && (
                <span className="ml-auto shrink-0 text-2xs text-accent">
                  found here
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>

      {!showAll && chapters.length > shown.length && (
        <button type="button" onClick={() => setShowAll(true)}
                data-testid="place-show-all"
                className="mt-1 text-micro text-text-muted hover:text-text-primary">
          Show the other {chapters.length - shown.length} chapters
          {" "}-- your book may put them somewhere it never says their name
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSave([...ticked])}
          disabled={busy}
          data-testid="place-save"
          className="inline-flex items-center gap-1 rounded bg-accent-fill px-2.5 py-1 text-mini font-semibold text-white hover:bg-accent-fill disabled:opacity-40"
        >
          {busy ? <Loader size={11} className="animate-spin" />
                : <Check size={11} />}
          Record {ticked.size} {ticked.size === 1 ? "chapter" : "chapters"}
        </button>
        <button type="button" onClick={onSkip} disabled={busy}
                data-testid="place-skip"
                className="rounded border border-border px-2.5 py-1 text-mini text-text-muted hover:text-text-primary disabled:opacity-40">
          Not now
        </button>
        {ticked.size === 0 && already.length > 0 && (
          // Unticking everything is a real answer -- "I placed this wrongly" --
          // and it has to be distinguishable from doing nothing, or the writer
          // has no way to undo a bad tag from inside the walk.
          <span className="text-micro text-warn/90">
            This will clear where {name} was recorded.
          </span>
        )}
      </div>
    </div>
  );
}
