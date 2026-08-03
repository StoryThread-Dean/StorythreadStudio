// features/audiobook/InsertWalkthroughHelp.tsx
// =============================================
// The Formatting Walkthrough's guided walk. Same shared card as the Cast
// panel's, in the walkthrough's own blue.
//
// Structure is the writer's own (2026-08-03 review): TRUNK, then BRANCHES,
// then the specifics of each branch. Step one says what this whole screen
// is for and that it is optional. Step two names the only two ways to use
// it. Step three teaches what a pause actually is. Only then does any step
// talk about a particular kind of stop. Reading an early step should never
// require knowing anything from a later one.
//
// Written for a first-time writer, not a developer. No "N", no "kinds",
// no "mute", no "trigger". If a sentence needs a second read, it is wrong.
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
    title: "What this is for",
    body: <>
      None of this is required. You can turn a chapter into audio without
      touching a single thing in here, and it will work.
      <br /><br />
      What it does is make the reading better. Where a pause falls, how
      long it holds, and how a tricky word is pronounced.
      <br /><br />
      The narrator on your machine is called Kokoro. It is free, it runs
      offline, and it is good, but it has real faults. It reads straight
      through moments where a person would stop for breath, and it
      sometimes says a word the wrong way. It cannot know that <i>read</i>
      {" "}in "I read it yesterday" is not the same sound as in "I read
      every day."
      <br /><br />
      This walkthrough exists to fix those two things. Let us go through
      each part, what it does, and why you might want it.
    </>,
  },
  {
    title: "Two ways to use it",
    body: <>
      <b>One at a time.</b> The walkthrough goes down your chapter and
      stops at each spot where it thinks something would help. You look at
      the sentence, choose how long the pause should be, and add it. Or you
      skip it and it moves on. Nothing is decided for you.
      <br /><br />
      <b>All at once.</b> Once you know what each part does and you trust
      it, you do not have to visit every stop. One button adds every pause
      it is suggesting, in one go. The list on the left is how you control
      that: tick the things you want it to suggest, untick the ones you do
      not.
      <br /><br />
      Start with one at a time. Move to all at once when you have heard
      enough of them to know what you are agreeing to.
    </>,
  },
  {
    title: "What a pause does",
    body: <>
      A pause is a piece of silence you place in the text. It is written
      like this, and the number is how many seconds it holds.
      <br /><br />
      Every stop in this walkthrough offers you three lengths. Here is the
      same sentence three times, so those numbers mean something before you
      have to pick one. Play them in order.
      <br /><br />
      Short is a breath. Long is a moment where something has changed. The
      only way to know which one a sentence wants is to hear it, which is
      why there is a Play button on everything in here.
    </>,
    example: <>She counted the steps. [pause:0.8] Nothing moved above her.</>,
    demos: [
      { kind: "beat-pause-flat", label: "No pause" },
      { kind: "beat-pause-short", label: "Short pause, 0.4 seconds" },
      { kind: "beat-pause-long", label: "Long pause, 1.5 seconds" },
    ],
  },
  {
    title: "Before dialogue",
    body: <>
      Now the specific spots, starting with the most common one. Your
      narration runs along and then somebody speaks.
      <br /><br />
      A person reading this aloud would stop for a moment and change their
      voice. The narrator does neither. It has one voice and it keeps going,
      so the spoken line arrives welded to the sentence in front of it and
      the listener has to work out who is talking.
      <br /><br />
      Listen to Elena losing her temper, without and then with the pause.
      <br /><br />
      One thing you do not have to worry about: when a spoken line starts
      its own paragraph, you already get a pause automatically. The
      walkthrough only asks about speech that begins partway through a
      paragraph, because that is the one nothing else covers.
    </>,
    demos: [
      { kind: "beat-dialogue-open-flat", label: "No pause before she speaks" },
      { kind: "beat-dialogue-open", label: "With a pause before she speaks" },
    ],
  },
  {
    title: "After dialogue",
    body: <>
      The same moment in reverse, and the same argument continuing. Elena
      has finished her line and the narrator picks the scene back up.
      <br /><br />
      Without a pause the narrator's own voice sounds like more of what
      Elena was saying, and it takes the listener a second to realise the
      speech ended.
      <br /><br />
      Play both. This is a smaller difference than the one before it, and
      it is the one writers most often skip and then miss.
    </>,
    demos: [
      { kind: "beat-dialogue-close-flat", label: "No pause after her line" },
      { kind: "beat-dialogue-close", label: "With a pause after her line" },
    ],
  },
  {
    title: "Short-sentence beats",
    body: <>
      Still the same scene. Three or more very short sentences in a row is
      something you did on purpose, and read aloud without any gaps they
      run together into one breath and the effect disappears.
      <br /><br />
      These offer the shortest pause first, because what you want is
      separation, not weight. A long pause here turns a quick run into a
      list.
      <br /><br />
      This is the one where you will disagree with the suggestion most
      often, and that is fine. Sometimes the faster version is better and
      the run should tumble forward. Sometimes the gaps give it a drum beat
      and it hits much harder. Only your ear can settle it, which is
      exactly why the walkthrough asks instead of just doing it.
    </>,
    // The writer asked for this warning, and asked specifically that the
    // demo NOT be cleaned up: the clip below slurs slightly, which is the
    // honest thing for it to do. A tutorial that only ever plays the
    // narrator at its best sets the writer up to think the first garbled
    // run in their own chapter is something they did.
    note: <>
      Pauses packed close together can make the narrator slur or run words
      together. You can hear a little of it in the second clip below. That
      is a limitation of Kokoro rather than anything this app is doing, and
      when it happens is unpredictable, though it shows up mostly when
      several pauses land near each other. If a run comes back muddy, use
      fewer pauses in it or space them further apart.
    </>,
    demos: [
      { kind: "beat-short-burst-flat", label: "No pauses, all one breath" },
      { kind: "beat-short-burst", label: "With a short pause between each" },
    ],
  },
  {
    title: "Interjections",
    body: <>
      A shout lands harder with a bit of room after it. Without one, the
      next sentence swallows it.
      <br /><br />
      This is the quietest difference of the four, so listen for the word
      "Enough" specifically rather than the sentence as a whole. If you
      cannot hear it on your voice, skip these. It is a small effect and
      there is no sense adding pauses you cannot hear.
    </>,
    demos: [
      { kind: "beat-interjection-flat", label: "No pause after the shout" },
      { kind: "beat-interjection", label: "With a pause after the shout" },
    ],
  },
  {
    title: "Word readings -- let your ear decide",
    body: <>
      This is the one that fixes an outright mistake rather than improving
      a good line, and it is worth the most of anything in here.
      <br /><br />
      Some words do not have one sound. <i>Read</i> is "reed" or "red".
      {" "}<i>Wound</i> is "woond" or "wow-nd". <i>Lead</i> is the metal or
      the verb. The narrator guesses from grammar it only half understands,
      and on these it guesses wrong more often than not.
      <br /><br />
      Play these. The first one is what your chapter sounds like right now,
      and it is simply wrong.
      <br /><br />
      Nothing here is applied for you, because which reading is right
      depends on what you meant. Each one gets a Play button that speaks
      {" "}<i>your own sentence</i>, and you pick the one you meant. If the
      narrator already says it correctly, skip it. That is the right answer
      most of the time.
    </>,
    example: <>Yesterday I [say:red]read[/say] the letter twice.</>,
    demos: [
      { kind: "word-reading-flat", label: 'Wrong: the narrator says "reed"' },
      { kind: "word-reading", label: 'Fixed: the narrator says "red"' },
    ],
  },
  {
    title: "Fixes",
    body: <>
      These are not suggestions. A marker with a typo in it, like{" "}
      <span className="font-mono">[pace:=2]</span>, or one you forgot to
      close, either does nothing at all or swallows the rest of your
      chapter. The walkthrough finds those and hands you the correction.
      <br /><br />
      Worth doing even if you skip everything else in here.
      <br /><br />
      One thing it will not do is guess. A pace marker can be broken in a
      way that could mean faster or slower, and only you know which you
      wanted, so it offers both and waits.
    </>,
    example: <>[pace:=2] &rarr; [pace:-2]</>,
  },
  {
    title: "Choosing what it suggests",
    body: <>
      The list on the left is everything the walkthrough looks for. The
      number beside each one is how many it found in this chapter. Untick
      anything you do not want to be asked about and it stops bringing
      those up.
      <br /><br />
      Underneath that list is a button that adds every pause still being
      suggested, all at once, at the shorter length. It asks you to confirm
      first, and the number on it is how many it is about to add.
      <br /><br />
      Two things that button will never do for you. It will not correct a
      broken marker, because that could go two ways and only you know which
      you meant. It will not choose how a word is pronounced, for the same
      reason. Both of those stay here for you to decide.
      <br /><br />
      Nothing in this walkthrough is written to your file until you press
      Save in the editor. If a whole batch turns out wrong, close without
      saving and none of it happened.
      <br /><br />
      Then listen to the chapter with the free narrator on your machine
      before you spend anything on a paid voice.
    </>,
  },
];

export function InsertWalkthroughHelp({ onClose }: { onClose: () => void }) {
  return <GuidedWalk steps={STEPS} tone="blue" onClose={onClose} />;
}
