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
    example: <>She turned back. [pause:0.8] The door was already shut.</>,
  },
  {
    title: "Before dialogue",
    body: <>
      Narration hands off to someone speaking. A person reading aloud
      takes a breath here and changes voice; the narrator does neither,
      so the spoken line arrives welded to the sentence in front of it.
      <br /><br />
      The walk only offers this <i>inside</i> a paragraph. When dialogue
      starts its own paragraph you already get a beat automatically --
      that is the paragraph gap in Audiobook Settings, 550 milliseconds by
      default. Mid-paragraph is the case nothing else covers, because the
      narrator treats the whole paragraph as one breath.
      <br /><br />
      Play both. The second one is the same sentence with the beat in it.
    </>,
    demos: [
      { kind: "beat-dialogue-open-flat", label: "Without a beat -- what you get today" },
      { kind: "beat-dialogue-open", label: "With a beat before the line" },
    ],
  },
  {
    title: "After dialogue",
    body: <>
      The same moment in reverse: someone stops speaking and the narration
      picks back up. Without a beat the narrator's own voice sounds like a
      continuation of the character's, and a listener needs a moment to
      work out that the speech ended.
      <br /><br />
      This one is worth listening to twice. It is a smaller difference than
      the one before it, and it is the stop writers most often skip and
      then miss.
    </>,
    demos: [
      { kind: "beat-dialogue-close-flat", label: "Without a beat -- the speech runs into the narration" },
      { kind: "beat-dialogue-close", label: "With a beat after the quote" },
    ],
  },
  {
    title: "Short-sentence beats",
    body: <>
      Three or more clipped sentences in a row is a rhythm you wrote on
      purpose. Read aloud without beats they blur into a single breath and
      the effect you built disappears.
      <br /><br />
      These offer the <i>shortest</i> pause by default, because the point
      is separation rather than weight. A long pause here turns a quick
      run into a list.
      <br /><br />
      The walk needs three in a row before it says anything. Two short
      sentences together is just prose, and stopping on every pair of them
      buried the real ones.
    </>,
    demos: [
      { kind: "beat-short-burst-flat", label: "Without beats -- four sentences in one breath" },
      { kind: "beat-short-burst", label: "With a short beat between each" },
    ],
  },
  {
    title: "Interjections",
    body: <>
      A short exclamation lands harder with air after it. Same idea as the
      short-sentence beats, aimed at the single line meant to stop the
      listener rather than at a run of them.
    </>,
    demos: [
      { kind: "beat-interjection-flat", label: "Without a beat -- the exclamation gets swallowed" },
      { kind: "beat-interjection", label: "With a beat after it" },
    ],
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
