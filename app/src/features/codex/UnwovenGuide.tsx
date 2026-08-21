// features/codex/UnwovenGuide.tsx -- what answering the ground rules is FOR
// ==========================================================================
// R6.4's second half. The board says how much world is undecided; this says why
// a novelist mid-draft should care, which is a different question and the one
// that decides whether the pass gets used at all.
//
// THE EXAMPLE IS MIDDLE-EARTH, for the same reason the subtext guide uses Snape:
// the walkthrough needs a world the reader already holds in their head, so every
// page can be about the MECHANISM rather than about learning a setting. It is
// also the fairest possible example of the thing being taught, because Tolkien
// answered these questions in appendices most readers never open, and the book
// is denser for it in ways readers feel without being able to point at.
//
// Nothing here is quoted. Every line of example text is written for this
// walkthrough, because the point is what THIS APP would produce and hold, not
// what a novel says.
//
// House style: no em dashes anywhere a writer reads.

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Page {
  title: string;
  body: React.ReactNode;
}

/** A question as the walk shows it, with the reason underneath. */
function Ask({ prompt, why }: { prompt: string; why: string }) {
  return (
    <div className="rounded border border-weave-soft/60 bg-weave-fill/5 p-2">
      <p className="text-xs font-medium text-text-primary">{prompt}</p>
      <p className="mt-1 text-mini text-faint">{why}</p>
    </div>
  );
}

/** An answer, in the writer's own words. Always labelled, so it is never
 *  mistaken for something the app decided. */
function Answer({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg-panel p-2">
      <p className="mb-1 text-micro uppercase tracking-wide text-faint">
        What you type
      </p>
      <p className="text-xs italic leading-relaxed text-text-primary">{children}</p>
    </div>
  );
}

function Prose({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg-surface p-2">
      <p className="mb-1 text-micro uppercase tracking-wide text-faint">{label}</p>
      <p className="text-xs italic leading-relaxed text-text-primary">{children}</p>
    </div>
  );
}

const PAGES: Page[] = [
  {
    title: "This pass is the only one that is not about mistakes",
    body: (
      <>
        <p>
          Every other pass compares two things you have already written and
          shows you where they disagree. This one cannot do that, because what
          it looks for is not in your book yet.
        </p>
        <p>
          Unwoven asks about the ground your story stands on. Who holds power.
          What your magic costs. What happens to somebody who cannot pay a
          debt. None of that can be found in a manuscript, because a manuscript
          shows the consequences of those rules rather than the rules.
        </p>
        <p className="text-text-primary">
          So nothing here is wrong, overdue, or a task. You are never behind on
          this pass, and you never have to finish it.
        </p>
      </>
    ),
  },
  {
    title: "Why it is worth answering at all",
    body: (
      <>
        <p>
          Because the alternative is deciding it in chapter nineteen, under
          pressure, in a way that contradicts chapter four.
        </p>
        <p>
          Take a world you already know. Somebody has to rule Gondor, and the
          throne has been empty for centuries while stewards hold it. That one
          decision is doing an enormous amount of work: it explains why a
          steward can refuse a claim, why the claim matters to anyone, why a
          returning king is a political event and not just a nice ending.
        </p>
        <p>
          A writer who decided that in advance can write chapter one knowing
          it. A writer who decides it late has to go back and put it there.
        </p>
      </>
    ),
  },
  {
    title: "A question, and what makes it answerable",
    body: (
      <>
        <p>Here is what a stop actually looks like.</p>
        <Ask
          prompt="When the person in charge dies, how is the next one decided?"
          why="Succession is where politics turns into plot. It also decides who has a motive the moment somebody gets ill."
        />
        <p>
          Two parts, and the second one is the part that matters. A prompt on
          its own is homework. A prompt with a reason is an offer: here is what
          you get for two minutes of thinking.
        </p>
        <p className="text-text-primary">
          Every question in this pass can be answered in a sentence. If one
          feels like it needs an essay, skip it. Skipping costs nothing and it
          will be there next time.
        </p>
      </>
    ),
  },
  {
    title: "Your answer goes somewhere real",
    body: (
      <>
        <Answer>
          The crown passes to the nearest male heir who can prove the line. In
          practice nobody has proved it in nine hundred years, so a steward
          rules and calls himself a servant.
        </Answer>
        <p>
          That does not become a note in a pile. It becomes an entry in your
          world, of a kind the rest of the app understands: a Ruling Authority, with
          your sentence in its Succession section.
        </p>
        <p>
          Which means the chip picker can attach it, search can find it, the
          export carries it, and the brief can send it to a model when you are
          writing a scene where it matters. An answer that lands nowhere is a
          note. An answer that lands somewhere is part of the world.
        </p>
      </>
    ),
  },
  {
    title: "Answering one question opens the ones it implies",
    body: (
      <>
        <p>
          This is the part that makes the pass worth opening twice. You did not
          just answer a question, you created a situation, and the situation
          has consequences you have not decided yet.
        </p>
        <Ask
          prompt="What stops every rival heir being killed in childhood?"
          why="You answered: When the person in charge dies, how is the next one decided? -- which raises this."
        />
        <p>
          Nobody asked you that on your first visit, because it makes no sense
          to somebody who has not yet said how succession works. It appeared
          because of what you wrote.
        </p>
        <p className="text-text-primary">
          Your world getting bigger as you decide things is the feature. It is
          not a list growing longer.
        </p>
      </>
    ),
  },
  {
    title: "And it reaches into other parts of your world",
    body: (
      <>
        <p>
          A world is a web rather than a tree, so some questions touch each
          other without either one coming first. Succession reaches into law
          (is killing kin prosecuted?) and into faith (does the church bless
          it?).
        </p>
        <p>
          Where you have already answered one of those, the stop says so. Not to
          make you consistent, which is your job, but because the connection is
          the interesting part and you would otherwise have to hold it in your
          head.
        </p>
        <p>
          Crosslinks never block anything. Two questions that each imply the
          other would deadlock, and you would be stuck looking at a pass with
          nothing in it.
        </p>
      </>
    ),
  },
  {
    title: "What it changes in the writing",
    body: (
      <>
        <p>
          Concretely: this is a paragraph written without the ground decided.
        </p>
        <Prose label="Before">
          The steward refused him. He had no right to the throne, and everyone
          in the hall knew it.
        </Prose>
        <p>
          It is fine, and it is vague in a specific way: it asserts a rule the
          reader has to take on trust. Now the same beat with an answer behind
          it.
        </p>
        <Prose label="After">
          The steward did not rise. Nine hundred years of stewards had not
          risen, and the words for it had worn smooth: he was a servant of the
          throne, and a servant does not judge a claim. He said so. It was, as
          always, a refusal shaped like humility.
        </Prose>
        <p className="text-text-primary">
          Nothing was added to the plot. The rule was already there once you had
          decided it, and the prose could lean on it.
        </p>
      </>
    ),
  },
  {
    title: "One question at a time, one part at a time",
    body: (
      <>
        <p>
          There are about a hundred of these across ten parts of a world, which
          is far too many to sit down and answer. So a sitting is deliberately
          short: a dozen questions, spread across your whole world rather than a
          dozen about your ruling authority.
        </p>
        <p>
          The board is where you see the rest. Every part, with how much of it
          is still open, and a bar showing how much you have decided. Pick one
          and the sitting asks about that part only, which is the right thing to
          do when you feel like spending an evening on your religion.
        </p>
        <p>
          The counts on the board are real. When a part reads zero, it is
          finished, and it stays on the board so you can see that it is.
        </p>
      </>
    ),
  },
  {
    title: "The two answers that are not answers",
    body: (
      <>
        <p>
          <span className="text-text-primary">Not yet</span> puts a question
          back. It returns next time, and nothing is recorded except that you
          were not ready.
        </p>
        <p>
          <span className="text-text-primary">Never ask this</span> retires it
          for good. Use it freely. A world with no magic does not need to be
          asked what magic costs, and a question that does not apply to your
          book is noise that makes the real ones easier to ignore.
        </p>
        <p>
          Retiring one moves the next question up rather than making the sitting
          shorter, so there is no cost to being decisive here.
        </p>
      </>
    ),
  },
  {
    title: "Where to start",
    body: (
      <>
        <p>
          Anywhere. There is no order, and the pass will not think less of you
          for skipping nine questions to answer the tenth.
        </p>
        <p>
          If you want a suggestion: answer the part of the world your current
          chapter is standing in. The questions are chosen so that an answer is
          useful the same day you give it, not eventually.
        </p>
        <p className="text-text-primary">
          And if you answer nothing at all, your book is not worse for it. This
          pass is here for the times when you know something is undecided and
          you cannot name what.
        </p>
      </>
    ),
  },
];

interface UnwovenGuideProps {
  onClose: () => void;
}

export function UnwovenGuide({ onClose }: UnwovenGuideProps) {
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
        aria-label="How the ground rules pass works"
        data-testid="unwoven-guide"
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

/** Page titles, exported so a test can walk the guide by NAME rather than by
 *  counting clicks. A count breaks the moment a page is inserted. */
export const UNWOVEN_GUIDE_TITLES = PAGES.map(p => p.title);
