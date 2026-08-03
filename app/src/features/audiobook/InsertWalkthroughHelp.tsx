// features/audiobook/InsertWalkthroughHelp.tsx
// =============================================
// The Formatting Walkthrough's guided walk. Same shared card as the Cast
// panel's, in the walkthrough's own blue.
//
// The thing this has to teach, above the mechanics, is WHY a narration
// marker exists at all. A writer reading their own prose supplies the
// beats without noticing; an engine does not, and the difference between
// a flat read and one that breathes is almost entirely these small
// silences. Every step therefore says what the reader HEARS, not what
// the button does.

import { GuidedWalk } from "./GuidedWalk";
import type { WalkStep } from "./GuidedWalk";

const STEPS: WalkStep[] = [
  {
    title: "What this walk is for",
    body: <>
      When you read your own writing, you pause without noticing -- after
      a name, before a turn, between two clipped sentences that are
      meant to land separately. The narrator does none of that unless
      you ask. This walk goes down the chapter from your cursor and stops
      at each place a small silence would probably help, so you decide
      one at a time instead of hunting for them.
      <br /><br />
      You never have to use it. Markers are plain text and you can type
      them yourself; this is just faster.
    </>,
  },
  {
    title: "Apply, or pick a different length",
    body: <>
      Each stop shows your real sentence with the proposal inline.{" "}
      <b>Apply</b> inserts it, <b>Skip</b> moves on without touching
      anything, and <b>Back</b> returns to the previous stop. Where a
      stop offers more than one length, the buttons beside Apply insert
      that one instead.
      <br /><br />
      Nothing here is saved. Edits land in the editor exactly as if you
      had typed them, and the editor's Save is what writes them to the
      file -- so an unconvincing walk costs one undo, or closing without
      saving.
    </>,
    example: <>...the tomb door. [pause:0.8] I read it twice.</>,
  },
  {
    title: "Before and after dialogue",
    body: <>
      The commonest two stops. Narration handing off to speech, and
      speech handing back, are the moments a human reader breathes and
      an engine runs straight through. A beat here is what stops a line
      of dialogue sounding welded to the sentence before it.
    </>,
    example: <>She turned. [pause:0.8] "You came back."</>,
  },
  {
    title: "Short-sentence beats",
    body: <>
      Consecutive clipped sentences are a rhythm you wrote on purpose --
      "I read it. The Cambodia chapter. My god." Read aloud without
      beats they blur into one breath and the effect is lost. These
      stops offer the shortest pause by default, because the point is
      separation, not weight.
    </>,
  },
  {
    title: "Interjections",
    body: <>
      A short exclamation lands harder with air around it. Same idea as
      the short-sentence beats, aimed at the single line that is meant
      to stop the reader.
    </>,
  },
  {
    title: "Marker problems",
    body: <>
      These are not suggestions -- they are repairs. A mistyped marker
      ([pace:=2]) or one you never closed ([pause:0.4 with no bracket)
      either does nothing or swallows the rest of the chapter, and the
      parser can only warn about it. The walk offers the fix in place.
      <br /><br />
      Worth doing even if you skip every other kind of stop.
    </>,
    example: <>[pace:=2] &rarr; [pace:-2]</>,
  },
  {
    title: "Word readings -- let your ear decide",
    body: <>
      Some words do not have one sound. <i>Read</i> is "reed" or "red",
      <i> wound</i> is "woond" or "wow-nd", <i>lead</i> is the metal or
      the verb. The narrator guesses from grammar it only half
      understands, and on these it guesses wrong more often than not --
      "I read it yesterday" comes out as "I reed it yesterday" every
      single time.
      <br /><br />
      Nothing here is applied for you, because which one is right depends
      on what you meant. Instead each reading gets a <b>Play</b> button
      that speaks <i>your own sentence</i> in the book's voice. Listen to
      both, click <b>Use this</b> on the one you meant, and move on. If
      the narrator already reads it correctly, Skip -- that is the right
      answer most of the time.
      <br /><br />
      Two seconds of listening settles this. No spelling on a screen
      could.
    </>,
    example: <>I [say:red]read[/say] it yesterday.</>,
  },
  {
    title: "Turn kinds off, or do the beats in one go",
    body: <>
      The checkboxes across the top mute a kind of stop entirely -- if
      you never want short-sentence beats, switch them off and the walk
      stops offering them.
      <br /><br />
      <b>Auto-apply N beats</b> inserts every remaining suggested beat at
      its default length in one go, behind a confirm. Marker repairs
      stay manual. It is the fast path, and the reason it warns is that
      an unreviewed beat can land inside a rhythm you built deliberately
      -- listen with the free local preview before you print with a paid
      voice.
    </>,
  },
  {
    title: "Keyboard, so you can keep typing",
    body: <>
      <b>Ctrl+Enter</b> applies, <b>Ctrl+Right</b> skips,{" "}
      <b>Ctrl+Left</b> goes back, <b>Esc</b> closes. They work while the
      editor has focus, so you can hand-edit a sentence mid-walk and
      carry on without reaching for the mouse.
    </>,
  },
];

export function InsertWalkthroughHelp({ onClose }: { onClose: () => void }) {
  return <GuidedWalk steps={STEPS} tone="blue" onClose={onClose} />;
}
