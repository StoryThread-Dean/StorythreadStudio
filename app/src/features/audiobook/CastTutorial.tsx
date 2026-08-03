// features/audiobook/CastTutorial.tsx
// ====================================
// A numbered walk through the Cast workbench itself, for a writer who
// has never cast a book.
//
// This app is a teaching tool before it is a production tool, and the
// four "what's this" answers beside it are REFERENCE -- good when you
// have a question, useless when you do not yet know what to ask. This is
// the other half: the order of operations, one step at a time, with an
// example of what each step actually looks like.
//
// Deliberately not a tour that moves the screen around or blocks the
// controls. A writer should be able to read step 3, do step 3, and come
// back -- so it sits in the panel, keeps its place, and everything
// underneath stays usable while it is open.

import { useState } from "react";
import { ChevronLeft, ChevronRight, GraduationCap, X } from "lucide-react";

interface CastTutorialProps {
  /** True once a print engine is connected -- the Pro step is skipped
   *  otherwise, because a step about a thing that is not on screen
   *  teaches nothing. */
  hasPrintEngine: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  body: React.ReactNode;
  example?: React.ReactNode;
}

export function CastTutorial({ hasPrintEngine, onClose }: CastTutorialProps) {
  const [index, setIndex] = useState(0);

  const steps: Step[] = [
    {
      title: "Add the people who speak",
      body: <>
        Under <b>Voices</b>, Storythread has already read your book and
        listed the names it found in dialogue tags. Press <b>+ Name</b> to
        make somebody a character. If a name should just be read by the
        narrator -- a shopkeeper with one line -- press <b>ignore</b> and
        it stops being offered.
        <br /><br />
        Anyone the list missed, type in yourself with <b>Add a character</b>.
      </>,
      example: <>Found in your book: <b>+ Elizabeth</b> <b>+ Darcy</b> <b>+ Innkeeper</b> ignore</>,
    },
    {
      title: "Give each character a voice",
      body: <>
        Pick a <b>Draft voice</b> for each one. These are your free local
        narrator's voices -- unlimited, nothing to pay, and you can press{" "}
        <b>Sample</b> to hear any of them before you decide. Leaving a
        character on "Same as the narrator" is a real answer too.
      </>,
      example: <>Elizabeth -- Emma (British female) [&gt; Sample]</>,
    },
    {
      title: "Tell it the nicknames",
      body: <>
        Your book probably calls Alexandra "Lexi" and "Lex" depending on
        who is talking. Open <b>Also called...</b> on her row and add those
        names from the list. Every one of them will be read in her voice.
        <br /><br />
        What gets written into your text is always her real name, so one
        character means one spelling in the file.
      </>,
      example: <>Alexandra -- Also called Lexi, Lex</>,
    },
    ...(hasPrintEngine ? [{
      title: "Pro voices are optional",
      body: <>
        The <b>Pro / Premium voice</b> column only matters if you plan to
        print with a paid engine. It starts at <b>-- None chosen</b> and
        can stay there forever. Nothing you do in this panel spends money.
      </> as React.ReactNode,
    }] : []),
    {
      title: "Choose how the dialogue gets marked",
      body: <>
        Under <b>Dialogue</b>, pick how much you want done for you, then
        press <b>Start</b>. Nothing runs until you do.
        <br /><br />
        <b>Manual</b> -- you decide every line.<br />
        <b>Automatic (free)</b> -- marks every line your own prose names
        ("...," Elizabeth said). No AI, no cost, instant.<br />
        <b>Automatic + AI</b> -- your tags first, then the AI names the
        lines it is confident about, and stops on the rest.<br />
        <b>Fully automatic</b> -- marks everything, including its
        guesses. Fast, and worth reviewing.
        <br /><br />
        The AI modes show what the chapter will cost before you press
        Start. It is normally a few cents.
      </>,
      example: <>Automatic (free) -- Start &rarr; "Marked 34 lines from your own dialogue tags. 11 left to decide."</>,
    },
    {
      title: "Walk the lines that are left",
      body: <>
        The window shows your real text with the line in question called
        out. Click a character to give them the line -- the marker appears
        immediately -- or <b>Keep narrator</b> if nobody should be cast.
        <b> Accept</b> moves on, <b>Back</b> returns.
        <br /><br />
        Each character has their own colour, and only the spoken words are
        coloured. The dialogue tag stays plain, because the narrator reads
        that part.
      </>,
      example: <>[voice:Elizabeth]"I could easily forgive his pride,"[/voice] she said.</>,
    },
    {
      title: "Check the AI's work",
      body: <>
        If you used an AI mode, the stats line offers{" "}
        <b>Review N AI choices</b>. That narrows the walk to only the lines
        the AI decided, so you can check its guesses without hunting for
        them among your own.
      </>,
    },
    {
      title: "Saving: two different things",
      body: <>
        <b>Save Cast</b> stores your characters and their voices. That is
        this panel's own button, and it is separate on purpose.
        <br /><br />
        The <b>markers in your text are not saved here.</b> They go into
        the editor behind this window, and the editor's Save is what
        writes them to the file -- exactly like typing. So if a pass goes
        badly, close without saving and none of it happened.
      </>,
    },
  ];

  const step = steps[Math.min(index, steps.length - 1)];

  return (
    <div className="rounded border border-violet-800 bg-violet-950/30 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <GraduationCap size={13} className="shrink-0 text-violet-300" />
        <span className="flex-1 text-[12px] font-semibold text-violet-100">
          {index + 1}. {step.title}
        </span>
        <button
          onClick={onClose}
          aria-label="Close the walkthrough"
          className="rounded p-0.5 text-violet-400 hover:text-violet-100"
        >
          <X size={13} />
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-violet-100/80">{step.body}</p>

      {step.example && (
        <p className="mt-1.5 rounded border border-violet-900 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-400">
          {step.example}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous step"
          className="inline-flex items-center gap-1 rounded border border-violet-800 px-2 py-0.5 text-[11px] text-violet-200 hover:border-violet-500 disabled:opacity-40"
        >
          <ChevronLeft size={11} /> Back
        </button>
        {index < steps.length - 1 ? (
          <button
            onClick={() => setIndex(i => i + 1)}
            aria-label="Next step"
            className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-violet-500"
          >
            Next <ChevronRight size={11} />
            <span data-testid="tutorial-progress">
              {index + 1} of {steps.length}
            </span>
          </button>
        ) : (
          <button
            onClick={onClose}
            className="rounded bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
          >
            Done --{" "}
            <span data-testid="tutorial-progress">
              {steps.length} of {steps.length}
            </span>
          </button>
        )}
        <span className="text-[10px] text-violet-300/60">
          Everything below stays usable while this is open.
        </span>
      </div>
    </div>
  );
}
