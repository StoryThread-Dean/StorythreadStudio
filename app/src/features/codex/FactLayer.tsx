// features/codex/FactLayer.tsx -- the fourth layer, and the only one that was missing
// ====================================================================================
// R8.9. The spec describes four zoom levels, each a view of the one above:
//
//     Constellation   the whole world
//     Neighborhood    one entry and what it touches      <- focusing a node
//     Thread card     the entry and its Run              <- the editors
//     Fact            one fact, its three switches, its evidence
//
// The first three exist. This is the fourth.
//
// IT IS DELIBERATELY READ-ONLY, and that is the whole design decision. The Run
// editor already edits the three switches, on two screens, sharing one
// component -- and building a second place to change them would produce two
// vocabularies for one idea, which is the failure this recovery keeps finding.
//
// So this layer answers a question nothing else answers: given this fact, WHAT
// DOES THE WORLD LOOK LIKE? Where is it in force, who can see it, what replaced
// it, what did it replace, and what would a model actually receive if the writer
// asked for help with chapter nine. The Run editor says what a fact IS. This
// says what it DOES, which is the part a writer cannot work out by reading the
// form -- the effect is spread across the resolver, the visibility rules and the
// brief, and no single screen had ever put it in one place.
//
// House style: no em dashes anywhere a writer reads.

import { CalendarOff, Check, Eye, EyeOff, Sparkles, User, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { BEFORE_STORY } from "./RunEditor";
import type { ChapterAnchor, Fact } from "./api";

interface FactLayerProps {
  fact: Fact;
  /** Every fact on the same entry, so this one can say what replaced it. */
  run: Fact[];
  chapters: ChapterAnchor[];
  /** Who can hold a belief, for turning a frame id into a name. */
  people?: { entity_id: string; name: string }[];
  /** The entry this belongs to, for the heading. */
  entryName: string;
  onClose: () => void;
}

/** A chapter's position in reading order, or -1. `before` sorts ahead of
 *  everything, which is exactly what it means. */
function positionOf(anchor: string | null | undefined,
                    chapters: ChapterAnchor[]): number {
  if (!anchor) return -1;
  if (anchor === BEFORE_STORY) return -1;
  return chapters.findIndex(c => c.anchor === anchor);
}

function chapterName(anchor: string | null | undefined,
                     chapters: ChapterAnchor[]): string {
  if (!anchor) return "";
  if (anchor === BEFORE_STORY) return "before the story starts";
  const i = positionOf(anchor, chapters);
  return i === -1 ? anchor : `${i + 1}. ${chapters[i].title}`;
}

export function FactLayer({ fact, run, chapters, people, entryName,
                            onClose }: FactLayerProps) {
  const placed = Boolean(fact.at);
  const from = positionOf(fact.at, chapters);
  // What ends this fact's reign: the earliest LATER fact that supersedes it.
  // Nothing else does -- a later fact on the same axis that does not claim to
  // replace this one is a Snag, not an ending, and saying otherwise here would
  // quietly take the resolver's side in an argument it refuses to settle.
  const replacedBy = run
    .filter(f => f.supersedes === fact.id)
    .sort((a, b) => positionOf(a.at, chapters) - positionOf(b.at, chapters))[0];
  const replaces = run.find(f => f.id === fact.supersedes);

  const frame = fact.frame && fact.frame !== "truth" ? fact.frame : "";
  const holder = frame
    ? (people ?? []).find(p => p.entity_id === frame)?.name ?? "one character"
    : "";

  // Where the reader finds out. Blank means "as it happens", which is the
  // ordinary case and not a gap.
  const learnsAt = fact.revealed_at || fact.at;
  const learns = positionOf(learnsAt, chapters);

  /** The span of chapters this is in force for, as a row of ticks. Drawn rather
   *  than described because "chapters 5 to 14 of 22" is a sentence a writer has
   *  to assemble, and a bar is a shape they can see. */
  const inForce = (i: number) => {
    if (!placed) return false;
    if (from !== -1 && i < from) return false;
    if (replacedBy) {
      const end = positionOf(replacedBy.at, chapters);
      if (end !== -1 && i >= end) return false;
    }
    return true;
  };
  const held = chapters.filter((_, i) => inForce(i)).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="What this fact does"
        data-testid="fact-layer"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-weave-soft bg-bg-panel"
      >
        <header className="flex items-start gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-micro uppercase tracking-wide text-faint">
              One fact on {entryName}
            </p>
            <h2 className="text-xs font-semibold text-text-primary">
              {fact.value?.trim() || "(nothing written yet)"}
            </h2>
          </div>
          <Explain of="thread.fact-layer" />
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="space-y-2 p-3">
          {/* ── Where it is in force ─────────────────────────────────────── */}
          <section>
            <h3 className="text-mini font-medium text-text-muted">
              Where it is true
            </h3>
            {!placed ? (
              <p className="mt-1 flex items-start gap-1.5 text-mini text-warn-strong"
                 data-testid="fact-unplaced">
                <CalendarOff size={11} className="mt-0.5 shrink-0" />
                <span>
                  Nowhere. Nothing says when this became true, so it never takes
                  effect and nothing downstream can use it. Give it a chapter in
                  the list above and this fills in.
                </span>
              </p>
            ) : (
              <>
                <div className="mt-1 flex gap-px" data-testid="fact-span"
                     aria-label={`In force for ${held} of ${chapters.length} chapters`}>
                  {chapters.map((c, i) => (
                    <span
                      key={c.anchor}
                      title={`${i + 1}. ${c.title}`}
                      className={`h-2 flex-1 rounded-sm ${
                        inForce(i) ? "bg-weave-fill" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-1 text-mini text-text-muted">
                  From {chapterName(fact.at, chapters)}
                  {replacedBy
                    ? <> until {chapterName(replacedBy.at, chapters)}, when
                        it is replaced.</>
                    : <> to the end of the book.</>}
                  {" "}That is {held} of {chapters.length} chapter
                  {chapters.length === 1 ? "" : "s"}.
                </p>
              </>
            )}
          </section>

          {/* ── Whose truth ──────────────────────────────────────────────── */}
          <section>
            <h3 className="text-mini font-medium text-text-muted">Whose truth</h3>
            <p className="mt-1 flex items-start gap-1.5 text-mini text-text-muted">
              <User size={11} className="mt-0.5 shrink-0 text-faint" />
              {frame ? (
                <span data-testid="fact-frame">
                  {holder} believes this. It is not true of the world unless
                  something else says so, and it is only drawn on when you are
                  writing from {holder}&apos;s point of view.
                </span>
              ) : (
                <span data-testid="fact-frame">
                  True of the world. Every character can be written as knowing
                  it, once the reader does.
                </span>
              )}
            </p>
          </section>

          {/* ── When the reader learns it ────────────────────────────────── */}
          <section>
            <h3 className="text-mini font-medium text-text-muted">
              When the reader learns it
            </h3>
            <p className="mt-1 flex items-start gap-1.5 text-mini text-text-muted">
              {fact.revealed_at
                ? <EyeOff size={11} className="mt-0.5 shrink-0 text-warn" />
                : <Eye size={11} className="mt-0.5 shrink-0 text-faint" />}
              {fact.revealed_at ? (
                <span data-testid="fact-reveal">
                  Held back until {chapterName(fact.revealed_at, chapters)}.
                  Before that the map hides it and the brief leaves it out, even
                  in chapters where it is already true.
                </span>
              ) : (
                <span data-testid="fact-reveal">
                  As it happens. Nothing is being held back, which is the
                  ordinary case and not a gap.
                </span>
              )}
            </p>
          </section>

          {/* ── What it replaces, and what replaces it ───────────────────── */}
          {(replaces || replacedBy) && (
            <section data-testid="fact-chain">
              <h3 className="text-mini font-medium text-text-muted">
                The chain it is part of
              </h3>
              <ul className="mt-1 space-y-0.5 text-mini text-text-muted">
                {replaces && (
                  <li>
                    It replaces{" "}
                    <span className="text-text-primary">
                      {replaces.value?.trim() || "(nothing written yet)"}
                    </span>
                    , from {chapterName(replaces.at, chapters)}.
                  </li>
                )}
                {replacedBy && (
                  <li>
                    It is replaced by{" "}
                    <span className="text-text-primary">
                      {replacedBy.value?.trim() || "(nothing written yet)"}
                    </span>
                    , from {chapterName(replacedBy.at, chapters)}.
                  </li>
                )}
              </ul>
            </section>
          )}

          {fact.intentional && (
            <p className="flex items-start gap-1.5 text-mini text-success-strong"
               data-testid="fact-intentional">
              <Check size={11} className="mt-0.5 shrink-0" />
              <span>
                You marked this deliberate, so the contradiction checks leave it
                alone.
              </span>
            </p>
          )}

          {/* ── What a model would actually receive ──────────────────────── */}
          {/* The payoff. Everything above is a rule; this is the consequence,
              and it is the only thing here a writer can act on directly. */}
          <section className="rounded border border-weave-soft/60 bg-weave-soft/20 p-2">
            <h3 className="flex items-center gap-1.5 text-mini font-medium text-weave-strong">
              <Sparkles size={11} className="shrink-0 text-weave" />
              What your AI gets
            </h3>
            <p className="mt-1 text-mini text-weave-strong/80"
               data-testid="fact-brief">
              {!placed
                ? "Nothing. An unplaced fact never reaches a brief."
                : learns === -1 && !fact.revealed_at
                  ? "This is carried wherever it is in force."
                  : <>
                      Ask for help with a scene from{" "}
                      {chapterName(learnsAt, chapters)} onwards and this is
                      carried{frame ? <> when you are writing {holder}</> : null}.
                      Ask about anything earlier and it is left out.
                    </>}
            </p>
          </section>

          <button
            onClick={onClose}
            className="text-mini text-faint hover:text-text-primary"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
