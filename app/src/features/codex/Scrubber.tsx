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

  if (chapters.length === 0) {
    return (
      <p className="text-[11px] text-faint">
        This project has no chapters yet, so there is no story to move through.
      </p>
    );
  }

  return (
    <div data-testid="scrubber">
      {/* ── Acts, as bands over the chapters they contain ───────────────── */}
      {hasActs && (
        <div className="mb-1 flex gap-px" aria-hidden="true">
          {bands.map((band, i) => (
            <div
              key={`${band.id}-${i}`}
              style={{ flexGrow: band.count }}
              className={`min-w-0 truncate rounded-sm px-1 py-0.5 text-[10px] uppercase tracking-wide ${
                band.id
                  ? "bg-violet-500/15 text-violet-200"
                  : "bg-bg-surface text-faint"
              }`}
              title={band.title || "Not in an act"}
            >
              {band.title || "Not in an act"}
            </div>
          ))}
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
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[7px]">
          {chapters.map((chapter, i) => (
            <span
              key={chapter.chapter_id}
              data-testid="scrubber-tick"
              data-active={i === value ? "true" : "false"}
              className={`h-2 w-2 rounded-full border transition-colors ${
                i === value
                  ? "scale-150 border-violet-300 bg-violet-400"
                  : i < value
                    ? "border-violet-700 bg-violet-800"
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
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent accent-violet-500 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-violet-300 [&::-webkit-slider-thumb]:bg-violet-500"
        />
      </div>

      {/* ── Chapter titles, with the resting one opened out ─────────────── */}
      <ol className="mt-0.5 flex gap-px" aria-hidden="true">
        {chapters.map((chapter, i) => {
          const here = i === value;
          return (
            <li
              key={chapter.chapter_id}
              data-testid="scrubber-title"
              data-active={here ? "true" : "false"}
              // The active chapter takes three times the room and wraps; the
              // rest stay narrow and truncate. This is the whole point of the
              // component: the handle visibly LANDS on a chapter.
              style={{ flexGrow: here ? 3 : 1, flexBasis: 0 }}
              className={`min-w-0 text-[10px] leading-tight ${
                here ? "font-semibold text-violet-200"
                     : "truncate text-faint"
              }`}
              title={`${i + 1} - ${chapter.title}`}
            >
              <span className={here ? "" : "text-faint"}>{i + 1}</span>{" "}
              {chapter.title}
            </li>
          );
        })}
      </ol>

      {/* Standing before chapter one is a real position -- it is the world as
          the reader meets it, before anything has happened -- and the track has
          nowhere to show that, so it is said in words. */}
      {value === BEFORE_THE_BOOK && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-violet-200">
          <History size={11} />
          Before the book begins: nothing has happened yet.
        </p>
      )}
    </div>
  );
}
