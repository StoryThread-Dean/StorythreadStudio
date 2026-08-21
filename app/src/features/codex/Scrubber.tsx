// features/codex/Scrubber.tsx -- moving through the story
// =======================================================
// The control that answers "who was she in chapter seven?" by letting the
// writer go and stand in chapter seven.
//
// WHAT WAS WRONG WITH THE FIRST VERSION
// -------------------------------------
// It was a bare slider with a dot, and the only feedback was a chapter title
// changing colour somewhere else on the screen. From review:
//
//     "There is no direct link/connection that sliding it does anything...
//      Writer needs to see an immediate and direct corolation that the slider
//      moves as Chapter in a timeline from Chapter 1 to Chapter N."
//
// A slider with no visible track is asking the writer to believe that dragging
// it means something. This draws the thing it is moving through:
//
//     Act I                    | Act II                   | Act III
//     (_)------o------o---------o------o------o------o------o------(_)
//     1 Chance   2 Thro..  3 Caug..  4 The..  5 A ..
//        Meeting
//        in the
//        Stacks
//
// THE EXPANSION IS THE CAUSE AND EFFECT. The chapter the handle is resting on
// shows its whole title, wrapped over as many lines as it needs; its
// neighbours truncate. So the writer sees the handle LAND on a chapter rather
// than inferring it from a colour change elsewhere.
//
// WHY IT IS STILL A REAL <input type="range">
// -------------------------------------------
// The drawn track is decoration over a genuine range input, kept for the
// reasons a custom widget would have to reimplement badly: arrow keys, Home
// and End, screen-reader announcements, and the fact that a range is already
// the right accessible role for "pick a point in an ordered series". The List
// view is the app's accessibility answer for the map, and a scrubber that
// could only be dragged would undercut it.

import { useMemo } from "react";
import { History } from "lucide-react";

import type { ChapterAnchor } from "./api";

/** Where the handle can rest. -1 is before the book begins. */
export const BEFORE_THE_BOOK = -1;

/**
 * The thumb's diameter, in px, and the whole reason this file does arithmetic.
 *
 * A range input's thumb does not travel the full width of its track: its
 * CENTRE runs from half a thumb in to half a thumb short of the far end,
 * because the thumb has to stay inside the box. So a tick drawn at 0% and a
 * thumb at its minimum are half a thumb apart, and the gap grows and shrinks
 * across the track.
 *
 * The first version spread the ticks edge to edge with `justify-between` and
 * they drifted -- reported as "the slider isn't lining up with the dots behind
 * it". Ticks are now placed with the same formula the browser uses for the
 * thumb, so they cannot disagree.
 *
 * Kept in sync with the thumb size set in the input's own classes below. If
 * one changes, both must.
 */
const THUMB = 16;

interface ScrubberProps {
  chapters: ChapterAnchor[];
  /** Index into chapters, or BEFORE_THE_BOOK. */
  value: number;
  onChange: (index: number) => void;
}

interface Band {
  id: string;
  title: string;
  count: number;
}

export function Scrubber({ chapters, value, onChange }: ScrubberProps) {
  // Acts as runs of consecutive chapters, so a band spans exactly the
  // chapters in it and its width is proportional to how much book it is.
  const bands = useMemo<Band[]>(() => {
    const out: Band[] = [];
    for (const chapter of chapters) {
      const id = chapter.act_id || "";
      const last = out[out.length - 1];
      if (last && last.id === id) last.count += 1;
      else out.push({ id, title: chapter.act_title || "", count: 1 });
    }
    return out;
  }, [chapters]);

  const hasActs = bands.some(b => b.id);

  /**
   * Where a value sits along the track, as a CSS length.
   *
   * The same expression the browser uses to place the thumb, so a tick, an act
   * edge and the handle all land on one grid. `value` may be fractional, which
   * is how an act band reaches half a step past its last chapter.
   *
   * There are chapters.length + 1 stops (before the book, then one per
   * chapter), so the fraction denominator is chapters.length -- NOT
   * chapters.length - 1. Getting that wrong is what put every tick one stop
   * out.
   */
  const at = (value: number): string => {
    const fraction = (value - BEFORE_THE_BOOK) / chapters.length;
    return `calc(${THUMB / 2}px + ${fraction} * (100% - ${THUMB}px))`;
  };

  if (chapters.length === 0) {
    return (
      <p className="text-mini text-faint">
        This project has no chapters yet, so there is no story to move through.
      </p>
    );
  }

  return (
    <div data-testid="scrubber">
      {/* ── Acts, as bands over the chapters they contain ───────────────── */}
      {hasActs && (
        <div className="relative mb-1 h-4" aria-hidden="true">
          {bands.map((band, i) => {
            // From where the PREVIOUS act ended to this act's last chapter's
            // own stop. Contiguous by construction, and each edge is a place
            // the handle actually rests -- which is what made the bands look
            // right in the first version even while the ticks did not.
            const first = bands.slice(0, i).reduce((n, b) => n + b.count, 0);
            const last = first + band.count - 1;
            return (
              <div
                key={`${band.id}-${i}`}
                data-testid="scrubber-act"
                style={{ left: at(first - 1),
                         width: `calc(${at(last)} - ${at(first - 1)})` }}
                className={`absolute top-0 min-w-0 truncate rounded-sm px-1 py-0.5 text-micro uppercase tracking-wide ${
                  band.id
                    ? "bg-weave-fill/15 text-weave-strong"
                    : "bg-bg-surface text-faint"
                }`}
                title={band.title || "Not in an act"}
              >
                {band.title || "Not in an act"}
              </div>
            );
          })}
        </div>
      )}

      {/* ── The track: one stop per chapter ─────────────────────────────── */}
      <div className="relative h-6">
        {/* The line, and a tick on every chapter. Ticks BEFORE the handle are
            filled: the map is showing everything up to here, and the track
            should say so rather than looking identical either side. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center">
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="pointer-events-none absolute inset-0">
          {/* Before the book is a stop like any other, so it gets a mark --
              which also anchors the left end of the track visually. */}
          <span
            data-testid="scrubber-start"
            data-active={value === BEFORE_THE_BOOK ? "true" : "false"}
            style={{ left: at(BEFORE_THE_BOOK) }}
            className={`absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm transition-colors ${
              value === BEFORE_THE_BOOK ? "bg-weave-muted" : "bg-border"
            }`}
          />
          {chapters.map((chapter, i) => (
            <span
              key={chapter.chapter_id}
              data-testid="scrubber-tick"
              data-active={i === value ? "true" : "false"}
              style={{ left: at(i) }}
              className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors ${
                i === value
                  ? "scale-150 border-weave bg-weave-muted"
                  : i < value
                    ? "border-weave-fill bg-weave-fill"
                    : "border-border bg-bg-primary"
              }`}
            />
          ))}
        </div>

        {/* The real control, transparent and on top. Everything above is
            decoration; this is what a keyboard and a screen reader use. */}
        <input
          type="range"
          min={BEFORE_THE_BOOK}
          max={chapters.length - 1}
          step={1}
          value={value}
          onChange={e => onChange(parseInt(e.target.value, 10))}
          aria-label="Point in the story"
          aria-valuetext={
            value === BEFORE_THE_BOOK
              ? "Before the book begins"
              : `Chapter ${value + 1}, ${chapters[value].title}`
          }
          // h-4/w-4 is THUMB above. The two have to agree or the ticks drift
          // again, which is the bug this arithmetic exists to fix. The -moz-
          // rules are for running the dev server in Firefox; the product is
          // WebView2, which takes the -webkit- ones.
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-weave [&::-moz-range-thumb]:bg-weave-fill [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-weave [&::-webkit-slider-thumb]:bg-weave-fill"
        />
      </div>

      {/* ── Chapter titles, with the resting one opened out ─────────────── */}
      {/* ON THE SAME GRID AS THE DOTS, which they were not.
          ─────────────────────────────────────────────────────────────────
          Reported: "the text titles for Chapters on the slider now appear out
          of position. Visually appearing to slide more consistently to the
          right instead of being aligned under the chapter representative Dot."

          Two separate offsets, and the second is the one that made it look like
          drift rather than a constant nudge:

            1. The dots sit at fraction (i + 1) / N, because there are N + 1
               stops once "before the book" is counted. The titles were N flex
               cells across the full width, centring each at (i + 0.5) / N --
               a constant half-cell to the left of its own dot.
            2. The resting title had flexGrow: 3, so every title AFTER it was
               pushed right by two cells' worth. That is why the error grew
               along the track instead of staying put.

          The old comment argued that centring each title on its tick would
          overlap the neighbours. That is true of the expanded one and false of
          the rest, so the answer is a width limit rather than a different
          grid: each title is centred on its own dot and clipped to the space
          between them, and the resting one is allowed to be wider and to wrap
          because it is the one being read. */}
      <div className="relative mt-0.5 h-7" aria-hidden="true">
        {chapters.map((chapter, i) => {
          const here = i === value;
          return (
            <span
              key={chapter.chapter_id}
              data-testid="scrubber-title"
              data-active={here ? "true" : "false"}
              style={{
                left: at(i),
                // The resting title gets three slots' worth; the others get
                // one, less a hair so neighbours do not touch.
                // One line: a newline inside calc() is invalid CSS and the
                // whole declaration is dropped, which is a silent way to lose
                // a layout rule.
                width: `calc((100% - ${THUMB}px) / ${chapters.length} * ${here ? 3 : 1} - 2px)`,
              }}
              className={`absolute top-0 -translate-x-1/2 text-center text-micro leading-tight ${
                here
                  ? "z-10 font-semibold text-weave-strong"
                  : "truncate text-faint"
              }`}
              title={`${i + 1} - ${chapter.title}`}
            >
              <span className={here ? "" : "text-faint"}>{i + 1}</span>{" "}
              {chapter.title}
            </span>
          );
        })}
      </div>

      {/* Standing before chapter one is a real position -- it is the world as
          the reader meets it, before anything has happened -- and the track has
          nowhere to show that, so it is said in words. */}
      {value === BEFORE_THE_BOOK && (
        <p className="mt-1 flex items-center gap-1.5 text-mini text-weave-strong">
          <History size={11} />
          Before the book begins: nothing has happened yet.
        </p>
      )}
    </div>
  );
}
