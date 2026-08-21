// screens/SubtextGuide.tsx -- how a secret trait actually behaves
// ==============================================================
// Asked for directly: "a Show me how this works walkthrough starting at a Page 1
// to N of exactly how the Importance Core through Background works on Hidden ...
// I want a real case use of how the system would interpret the Importance and
// how it would work subtly within a Passage update through the feature Enhance,
// or how Smart Advisor reads and interprets it through Context checks or through
// the Draft creation. The writer should know what it is, how it works, examples
// of how it works and the end results of different path choices."
//
// So this is not a definition with buttons. It walks one secret through three
// weights and three features, and shows what each choice produces.
//
// THE EXAMPLE IS SEVERUS SNAPE, because the whole point needs a character whose
// surface and hidden layer are BOTH already known to the reader -- the reason he
// behaves as he does is famously withheld for seven books while shaping every
// scene he is in. That is exactly the pair this setting exists for.
//
// EVERY PASSAGE BELOW IS WRITTEN FOR THIS WALKTHROUGH. Nothing is quoted from
// the books; the point is to show what THIS APP would produce from a profile,
// which means the prose has to come from the app's own worked example rather
// than from the source.
//
// House style applies to all of it: no em dashes anywhere in what a writer reads.

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Page {
  title: string;
  body: React.ReactNode;
}

/** A block of example prose, always labelled as an example so it is never
 *  mistaken for something the app is asserting about the writer's book. */
function Example({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg-panel p-2">
      <p className="mb-1 text-micro uppercase tracking-wide text-faint">{label}</p>
      <div className="space-y-1.5 text-xs italic leading-relaxed text-text-primary">
        {children}
      </div>
    </div>
  );
}

/** One trait, as the model receives it. */
function AsSent({ line }: { line: string }) {
  return (
    <pre className="overflow-x-auto rounded bg-bg-surface px-2 py-1.5 text-mini not-italic text-success-strong">
      {line}
    </pre>
  );
}

const PAGES: Page[] = [
  {
    title: "Two questions, not one",
    body: (
      <>
        <p>
          Every trait you write answers two questions that have nothing to do
          with each other.
        </p>
        <p>
          <span className="text-text-primary">How much does this shape them?</span>{" "}
          That is the weight: Core, Present, Background, Contextual.
        </p>
        <p>
          <span className="text-text-primary">May it be said out loud?</span>{" "}
          That is this setting. Turn it on and AI still gets the trait, still
          uses it at its full weight, and is forbidden from ever naming it. It
          shows as behaviour and nothing else.
        </p>
        <p className="text-faint">
          These used to be one control, and that was the problem: a secret had to
          be filed as the least important thing on the page. Most secrets are the
          opposite of unimportant.
        </p>
      </>
    ),
  },
  {
    title: "The example: a man whose reasons are never stated",
    body: (
      <>
        <p>
          Severus Snape is the clearest case in popular fiction, because you
          probably remember both halves of him. On the surface: cold, unfair to
          one particular boy, inexplicably invested in that boy's survival.
          Underneath: he loved the boy's mother, and blames himself for her
          death.
        </p>
        <p>
          Nobody is told the second half for most of seven books. It is also the
          reason for almost everything he does. That is the pair this setting
          exists for, and it is why secrecy cannot be a low weight.
        </p>
        <p className="text-faint">
          Every passage in this walkthrough was written for it. None of it is
          quoted from the books, because the point is to show what this app makes
          from a profile.
        </p>
      </>
    ),
  },
  {
    title: "Core, and secret",
    body: (
      <>
        <p>
          The load-bearing one. It decides what he will and will not do, in every
          scene, whether or not the scene is about it.
        </p>
        <AsSent line={'- guilt over her death [core, SUBTEXT]: He loved her. He gave away the thing that got her killed, and has spent every year since keeping her son alive without letting anyone see him do it.'} />
        <p>
          Core means it is always in play. SUBTEXT means the reason never reaches
          the page. What you get is a man acting on something the reader cannot
          name.
        </p>
        <Example label="A drafted moment, written from that trait">
          <p>
            "Move," he said, and the boy moved, because there was nothing else in
            the voice to argue with. The corridor was empty by the time the
            ceiling came down. He did not watch it fall. He was already three
            doors along, writing up the detention he would give for being out
            after hours.
          </p>
        </Example>
        <p className="text-faint">
          He saves him and punishes him in the same breath. The cause is doing all
          the work and is never mentioned.
        </p>
      </>
    ),
  },
  {
    title: "Present, and secret",
    body: (
      <>
        <p>
          Regularly active. It surfaces when the scene puts the trigger in front
          of him, and stays quiet otherwise.
        </p>
        <AsSent line={'- cannot hold the boy\'s gaze [present, SUBTEXT]: The eyes are hers. Looking straight at them costs him something, so he looks slightly away, or at the desk, or at the door.'} />
        <p>
          Not every scene has him looking at Harry. When one does, this is what
          the reader sees.
        </p>
        <Example label="A drafted moment, written from that trait">
          <p>
            "Look at me when I am speaking to you." The boy did. For a moment
            neither of them said anything, and then Snape turned to the window
            and finished the sentence to the glass.
          </p>
        </Example>
        <p className="text-faint">
          A Present secret gives you a beat, in the right place, without
          explaining itself.
        </p>
      </>
    ),
  },
  {
    title: "Background, and secret",
    body: (
      <>
        <p>
          True, and rarely foregrounded. It tints one line somewhere and is
          otherwise silent.
        </p>
        <AsSent line={'- keeps one page of her handwriting [background, SUBTEXT]: Folded, in a drawer he does not open in front of anybody.'} />
        <Example label="A drafted moment, written from that trait">
          <p>
            He shut the drawer before he sat down, the way a man closes a door in
            his own house, without looking.
          </p>
        </Example>
        <p className="text-faint">
          Background is where most secrets belong. Weight is not a measure of how
          much a thing matters to you; it is how often it should reach the page.
        </p>
      </>
    ),
  },
  {
    title: "The same secret at three weights",
    body: (
      <>
        <p>
          This is what your choice actually changes. One trait, three settings,
          the same scene: he passes a hospital wing where a student is being
          treated.
        </p>
        <Example label="Core">
          <p>
            He did not go in. He read the list on the door twice, told the
            portrait beside it to fetch someone competent, and was gone before
            anyone could ask him to help.
          </p>
        </Example>
        <Example label="Present">
          <p>
            He paused at the door, then carried on. Whatever was happening in
            there was being handled.
          </p>
        </Example>
        <Example label="Background">
          <p>He walked past the hospital wing without slowing.</p>
        </Example>
        <p className="text-faint">
          Core makes the secret drive the scene. Present lets it interrupt the
          scene. Background lets it colour a clause. None of the three explains
          anything, and that is the setting doing its job at every weight.
        </p>
      </>
    ),
  },
  {
    title: "In a Draft",
    body: (
      <>
        <p>
          Draft mode writes new prose from what it has been given. A secret
          arrives with the instruction to use it and never state it, so it comes
          back as behaviour: a hesitation, an avoidance, a choice that does not
          fit what anyone in the room knows.
        </p>
        <p>
          If AI is about to write the cause, it is required to stop and rewrite it
          as something observable instead.
        </p>
        <Example label="What it will not write">
          <p>
            He could not look at the boy, because the boy had Lily's eyes, and
            every time he saw them he remembered what he had done.
          </p>
        </Example>
        <Example label="What it writes instead">
          <p>He addressed the boy's forehead, and then the parchment.</p>
        </Example>
      </>
    ),
  },
  {
    title: "In an Enhance pass",
    body: (
      <>
        <p>
          Enhance works over a paragraph you wrote. A secret gives it grounds to
          add behaviour and never grounds to add explanation, so the pass makes
          your line more particular rather than more informative.
        </p>
        <Example label="Your paragraph">
          <p>
            Snape looked at Harry and told him to sit down. Harry sat. The room
            was quiet.
          </p>
        </Example>
        <Example label="After an Enhance pass, with the secret Present">
          <p>
            Snape's eyes went to Harry and away again, to the chair. "Sit."
            Harry sat. The quiet went on a beat longer than it needed to.
          </p>
        </Example>
        <p className="text-faint">
          Nothing was revealed. One glance moved, and a silence got a length.
        </p>
      </>
    ),
  },
  {
    title: "In Smart Advisor's context check",
    body: (
      <>
        <p>
          The context pass reads your passage against your profiles. Here the
          rule works differently, and deliberately: the Advisor is writing{" "}
          <span className="text-text-primary">to you</span>, about a note{" "}
          <span className="text-text-primary">you</span> wrote. So it may name
          the secret plainly.
        </p>
        <Example label="What the Advisor may say to you">
          <p className="not-italic">
            This scene has him meeting Harry's eyes steadily for a full
            exchange, which runs against his [present, SUBTEXT] trait "cannot
            hold the boy's gaze". If that is deliberate, it reads as a
            significant moment. If not, one look away would fix it.
          </p>
        </Example>
        <p>
          What it may not do is hand you replacement prose that states the
          reason. Suggested text is still bound by the rule; the feedback around
          it is not.
        </p>
        <p className="text-faint">
          This was the other way round until recently, and it made every note
          about your best material uselessly vague.
        </p>
      </>
    ),
  },
  {
    title: "What happens if you turn it off",
    body: (
      <>
        <p>
          Turn the setting off and the trait becomes ordinary. AI may refer to it
          as openly as it refers to hair colour, in prose, at whatever weight you
          gave it.
        </p>
        <Example label="The same scene, secret OFF">
          <p>
            He looked away from the boy's eyes. They were Lily's eyes, and after
            all these years he still could not meet them without remembering the
            night he had traded her life for his own standing.
          </p>
        </Example>
        <p>
          That is a legitimate choice; it is simply a different book. The
          question the setting asks is whether the reader is being shown the
          effect or told the cause.
        </p>
      </>
    ),
  },
  {
    title: "A secret is not the same as a reveal",
    body: (
      <>
        <p>
          Two different jobs, and it is worth keeping them apart.
        </p>
        <p>
          <span className="text-text-primary">Never said</span> is this setting.
          A cause the reader feels and is never told, at any point.
        </p>
        <p>
          <span className="text-text-primary">Not said yet</span> is a fact with
          a chapter attached: the reader learns it in chapter thirty-four, and
          from then on it is ordinary knowledge. That lives on the entry's Run,
          where a fact can carry the chapter it becomes known in.
        </p>
        <p className="text-faint">
          Snape is both, which is why he is a good example and a slightly unfair
          one. His feeling for her is subtext for seven books; the moment the
          reader is finally told is a reveal. Use this setting for the first and
          a dated fact for the second.
        </p>
      </>
    ),
  },
];

interface SubtextGuideProps {
  onClose: () => void;
}

export function SubtextGuide({ onClose }: SubtextGuideProps) {
  const [index, setIndex] = useState(0);
  const page = PAGES[index];
  const last = index === PAGES.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="How a secret trait works"
        data-testid="subtext-guide"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-weave-soft bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-micro uppercase tracking-wide text-faint">
              Page {index + 1} of {PAGES.length}
            </p>
            <h2 className="truncate text-xs font-semibold text-text-primary">
              {page.title}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-xs leading-relaxed text-text-muted">
          {page.body}
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
          >
            <ChevronLeft size={12} /> Back
          </button>
          <span className="flex-1" />
          {last ? (
            <button
              onClick={onClose}
              className="rounded bg-weave-fill px-3 py-1 text-xs font-semibold text-white hover:bg-weave-fill"
            >
              Done
            </button>
          ) : (
            <button
              onClick={() => setIndex(i => Math.min(PAGES.length - 1, i + 1))}
              className="inline-flex items-center gap-1 rounded bg-weave-fill px-3 py-1 text-xs font-semibold text-white hover:bg-weave-fill"
            >
              Next <ChevronRight size={12} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The page titles, exported so a test can walk the guide by name rather than
 *  by counting clicks -- a count breaks the moment a page is inserted. */
export const SUBTEXT_GUIDE_TITLES = PAGES.map(p => p.title);
