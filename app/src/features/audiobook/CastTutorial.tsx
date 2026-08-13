// features/audiobook/CastTutorial.tsx
// ====================================
// The Cast workbench's guided walk: what to do, in order, for a writer
// who has never cast a book. The card itself is GuidedWalk -- this file
// is only the steps.

import { GuidedWalk } from "../../components/learn/GuidedWalk";
import type { WalkStep } from "../../components/learn/GuidedWalk";

interface CastTutorialProps {
  /** True once a print engine is connected -- the Pro step is skipped
   *  otherwise, because a step about a control that is not on screen
   *  teaches nothing. */
  hasPrintEngine: boolean;
  onClose: () => void;
}

export function CastTutorial({ hasPrintEngine, onClose }: CastTutorialProps) {
  const steps: WalkStep[] = [
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
      </>,
    } as WalkStep] : []),
    {
      title: "Choose how the dialogue gets marked",
      body: <>
        Under <b>Dialogue</b>, pick how much you want done for you, then
        press <b>Start</b>. Nothing runs until you do.
        <br /><br />
        <b>Manual</b> -- you decide every line.<br />
        <b>Automatic (free)</b> -- marks every line your own prose names,
        by a dialogue tag or an action beat. No AI, no cost, instant.<br />
        <b>Automatic + AI</b> -- your prose first, then the AI names the
        lines it is confident about, and stops on the rest.<br />
        <b>Fully automatic</b> -- marks everything, including its
        guesses. Fast, and worth reviewing.
        <br /><br />
        The AI modes show what the chapter will cost before you press
        Start. It is normally a few cents.
      </>,
      example: <>Automatic (free) -- Start &rarr; "Marked 34 lines from your own prose. 11 left to decide."</>,
    },
    {
      title: "Walk the lines that are left",
      body: <>
        The window shows your real text with the line in question called
        out. Click a character to give them the line -- the marker appears
        immediately -- or <b>Keep narrator</b> if nobody should be cast.
        <b> Accept</b> moves on, <b>Back</b> returns, <b>Hear it</b> plays
        the line as it will actually sound.
        <br /><br />
        Keys 1-9 pick a speaker, Enter accepts, P plays. Each character
        has their own colour, and only the spoken words are coloured --
        the dialogue tag stays plain, because the narrator reads that part.
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

  return <GuidedWalk steps={steps} tone="violet" onClose={onClose} />;
}
