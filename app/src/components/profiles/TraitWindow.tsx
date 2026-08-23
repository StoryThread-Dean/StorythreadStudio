// components/profiles/TraitWindow.tsx -- when a trait is true
// =============================================================
// A trait used to be a claim about a person, full stop. That is right for most
// of them and wrong for every character who CHANGES, which is most protagonists
// in most books.
//
// The report that produced this, in the writer's words: "Serena in Chapter 1 of
// Becoming a Hero is a scrawny, average looking young woman ... But after her
// transformation, she's physically taller, built like a fitness supermodel and
// different features and proportions. Those physical description traits are not
// true in Chapter 1 but are true in the rest of the chapters."
//
// Both descriptions are honest. Neither is the character. A profile that can
// hold only one makes the writer pick which half of their protagonist the AI is
// allowed to know -- and a profile holding both, with nothing to tell them
// apart, hands a model two bodies and lets it split the difference.
//
// ── IT IS `appears_in`, ONE LEVEL DOWN ──────────────────────────────────────
//
// Deliberately not a new idea. An ENTRY already says where in the book it
// appears; this says where in the book a TRAIT is true. Same list of anchors,
// same authored-not-derived rule, same chapter-level comparison, same room for
// scenes later. A writer who has met one has met the other.
//
// ── THE DEFAULT IS THE OLD BEHAVIOUR, EXACTLY ───────────────────────────────
//
// No window means always true. Every trait ever written is in that state and
// stays in it. Nothing changes for a writer who never opens this.

import { useMemo } from "react";
import { CalendarClock, ChevronsDown } from "lucide-react";

import { Explain } from "../learn/Explain";

export interface TraitWindowChapter {
  anchor: string;
  title: string;
}

interface Props {
  /** The chapters this trait is true in. Absent = always true, and absent
   *  means BOTH `undefined` and `null` -- see the `always` line below. */
  trueIn?: string[] | null;
  chapters: TraitWindowChapter[];
  /** Pass `undefined` to go back to always true. */
  onChange: (trueIn: string[] | undefined) => void;
  /** Why the chapter list cannot be shown, when it cannot. */
  unavailable?: string;
}

export function TraitWindow({ trueIn, chapters, onChange, unavailable }: Props) {
  // `== null`, NOT `=== undefined`, and this line was a real bug for a whole
  // release. Absent means always true; `[]` means true nowhere. Those two must
  // never collapse -- but there are TWO ways to spell absent by the time a
  // value reaches this component, and the strict check only knew one of them.
  //
  // The profiles/ path returns the backend's Pydantic model straight to the
  // screen, and FastAPI serialises an unset `true_in` as JSON `null`. So a
  // trait that had never been given a window arrived here as `null`, read as
  // "a window exists and nothing is ticked", and rendered the switch OFF with
  // the "not sent to AI at all" warning under it. Turning the switch on worked
  // in memory and was undone by the save's own response.
  //
  // TypeScript could not catch it: the declared type said `string[] |
  // undefined` and the wire disagreed. The rest of the codebase already writes
  // `!= null` for exactly this (see profileSource.ts); this control was the one
  // place that did not.
  const always = trueIn == null;
  const ticked = useMemo(() => new Set(trueIn ?? []), [trueIn]);

  // The chapters this trait is true in, as a writer would say it: "chapters
  // 2-9" rather than a list of anchors or a bare count. Consecutive numbers
  // collapse, because a transformation partway through a book produces one
  // long run and reading it as eight separate numbers helps nobody.
  const summary = useMemo(() => {
    const numbers = chapters
      .map((chapter, index) => (ticked.has(chapter.anchor) ? index + 1 : 0))
      .filter(Boolean);
    if (numbers.length === 0) return "";

    const runs: [number, number][] = [];
    for (const n of numbers) {
      const last = runs[runs.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else runs.push([n, n]);
    }
    const parts = runs.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}-${hi}`));
    return `${numbers.length === 1 ? "Chapter" : "Chapters"} ${parts.join(", ")}`;
  }, [chapters, ticked]);

  const toggle = (anchor: string) => {
    const next = new Set(ticked);
    if (next.has(anchor)) next.delete(anchor);
    else next.add(anchor);
    onChange([...next]);
  };

  // FROM HERE ON, which is the shape the real case actually has. A trait
  // rarely holds in chapters 3, 7 and 11 -- it starts being true when
  // something happens and stays true. Ticking eighteen boxes by hand to say
  // "after the transformation" is the sort of chore that makes a writer decide
  // the feature is not worth it.
  const fromHereOn = (index: number) => {
    const next = new Set(ticked);
    for (const chapter of chapters.slice(index)) next.add(chapter.anchor);
    onChange([...next]);
  };

  return (
    <div className="mt-2 rounded border border-border bg-bg-surface/40 p-2"
         data-testid="trait-window">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={12} className="shrink-0 text-accent" />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-primary">
          <input
            type="checkbox"
            checked={always}
            data-testid="trait-window-always"
            // ON goes back to no window at all rather than to "every chapter
            // ticked". They would read the same today and diverge the moment
            // the writer writes chapter 20: a list would silently exclude it,
            // and the trait would stop being true in new work for no reason
            // the writer could see.
            onChange={() => onChange(always ? [] : undefined)}
          />
          True all the way through
        </label>
        <Explain of="character.traitWindow" compact align="right" />
      </div>

      {!always && (
        <div className="mt-2" data-testid="trait-window-picker">
          <p className="text-mini text-faint">
            This trait is only true in these chapters. Anywhere else it is left
            out of what the app sends AI -- so the version of this character
            that reaches a model matches the chapter you are writing.
          </p>

          {unavailable ? (
            <p className="mt-1.5 text-mini text-faint"
               data-testid="trait-window-unavailable">
              {unavailable}
            </p>
          ) : (
            <>
              <ul className="mt-1.5 max-h-36 space-y-0.5 overflow-y-auto"
                  data-testid="trait-window-chapters">
                {chapters.map((chapter, index) => (
                  <li key={chapter.anchor} className="flex items-center gap-1">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-mini hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={ticked.has(chapter.anchor)}
                        onChange={() => toggle(chapter.anchor)}
                      />
                      <span className="truncate text-text-primary">
                        {chapter.title}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => fromHereOn(index)}
                      aria-label={`True from ${chapter.title} onward`}
                      title="True from here to the end of the book"
                      className="shrink-0 rounded p-0.5 text-faint hover:text-text-primary"
                    >
                      <ChevronsDown size={11} />
                    </button>
                  </li>
                ))}
              </ul>

              {/* WHAT THE WRITER HAS JUST SAID, in one line, always. The empty
                  case especially: a trait ticked nowhere is switched off
                  everywhere, and that is a real state worth being able to
                  reach -- but not one to discover later by noticing a
                  character has gone quiet. */}
              {summary ? (
                <p className="mt-1 text-mini text-success"
                   data-testid="trait-window-summary">
                  True in {summary}. Left out everywhere else.
                </p>
              ) : (
                <p className="mt-1 text-mini text-warn"
                   data-testid="trait-window-empty">
                  Nothing ticked, so this trait is not true anywhere and is not
                  sent to AI at all. Tick a chapter, or switch it back to true
                  all the way through.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
