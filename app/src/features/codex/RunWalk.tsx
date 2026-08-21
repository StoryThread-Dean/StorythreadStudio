// features/codex/RunWalk.tsx -- teaching the three facts a belief needs
// =======================================================================
// R8.8. The shared GuidedWalk card had never appeared on a Weave surface, and
// this is the surface that most needed one.
//
// THE PROGRAMME'S OWN OPENING EXAMPLE is a heroine who believes her father died
// until chapter fifteen. Everything in the Weave -- frames, `revealed_at`, the
// spoiler scrubber, the whole reason facts are anchored rather than written into
// a profile -- exists to make that recordable. It CAN be recorded now (R2.5, and
// test_the_opening_example.py does it over HTTP).
//
// What was still missing is that a writer looking at an empty Run editor has no
// way to guess it takes THREE facts, or why. One fact reading "believes her
// father died" is the obvious thing to type and it produces a world where
// nobody, including the heroine, ever learns otherwise. That is not a bug the
// app can detect: it is a perfectly consistent world, just not the writer's.
//
// So this walk teaches the shape, using the app's own example, and it shows
// rather than describes -- each step carries what the brief would actually
// contain, which is the only place the difference between one fact and three
// becomes visible.
//
// House style: no em dashes anywhere a writer reads.

import { GuidedWalk, type WalkStep } from "../../components/learn/GuidedWalk";

/** A line of the brief, as the model would receive it. */
function Brief({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-micro leading-relaxed">{children}</span>;
}

const STEPS: WalkStep[] = [
  {
    title: "Some things are only true for part of the book",
    body: (
      <>
        The sections above are for what is true throughout: what someone is
        like, where a place is, what a faction wants. This list is for what
        CHANGES. A rank earned in chapter nine, a secret learned in chapter
        fifteen, a scar that was not there in chapter one.
      </>
    ),
    example: "Every fact here says what became true, and where.",
  },
  {
    title: "A belief is a fact too, and it is the hard one",
    body: (
      <>
        This app was designed around one example: a heroine who believes her
        father died until chapter fifteen. It takes three facts, and typing one
        is the mistake almost everyone makes first.
      </>
    ),
    note: (
      <>
        One fact reading &quot;believes her father died&quot; makes a world
        where nobody, including her, ever learns otherwise. Nothing will warn
        you: that world is perfectly consistent, it is just not your book.
      </>
    ),
  },
  {
    title: "First: what she believes, on her own frame",
    body: (
      <>
        Write it as her belief and set the frame to her. A frame is whose truth
        this is. Her belief is not what happened, and the app has to be able to
        tell those apart, or writing a scene from her point of view would hand
        the model the answer she does not have.
      </>
    ),
    example: "father.fate  =  Died in the raid.   frame: her   from: chapter 1",
    demos: [{
      play: "shown", kind: "belief", label: "In her scenes",
      body: <Brief>Elara believes: her father died in the raid.</Brief>,
    }],
  },
  {
    title: "Second: what actually happened",
    body: (
      <>
        The same subject, on the truth frame, from wherever it became true. This
        is the one the reader must not meet early, so it carries the point where
        the reader learns it: chapter fifteen.
      </>
    ),
    example: "father.fate  =  Alive, in hiding.   frame: truth   reader learns: ch 15",
    demos: [{
      play: "shown", kind: "truth", label: "In chapter 3",
      body: <Brief>(nothing: the reader has not been told)</Brief>,
    }, {
      play: "shown", kind: "truth-late", label: "In chapter 16",
      body: <Brief>Her father is alive, in hiding.</Brief>,
    }],
  },
  {
    title: "Third: the moment she changes her mind",
    body: (
      <>
        A third fact, on HER frame again, from chapter fifteen, replacing the
        first. Without it she goes on believing him dead forever, in every scene
        after the reveal, and the model will keep writing her that way.
      </>
    ),
    example: "father.fate  =  Knows he is alive.   frame: her   from: ch 15   replaces the first",
    demos: [{
      play: "shown", kind: "changed", label: "In chapter 16",
      body: <Brief>Elara knows her father is alive.</Brief>,
    }],
  },
  {
    title: "What you get for it",
    body: (
      <>
        Ask for help with a chapter three scene and the brief carries her
        mistake, not the answer. Ask about chapter sixteen and it carries what
        she now knows. The story scrubber will walk the same change, and the map
        will hide the connection until the reader has met it.
      </>
    ),
    note: (
      <>
        You never have to do any of this. A fact with no frame is simply true,
        which is right for most of what you will write here. Reach for frames
        when a character is wrong about something on purpose.
      </>
    ),
  },
];

export const RUN_WALK_TITLES = STEPS.map(s => s.title);

export function RunWalk({ onClose }: { onClose: () => void }) {
  return <GuidedWalk steps={STEPS} tone="violet" onClose={onClose} />;
}
