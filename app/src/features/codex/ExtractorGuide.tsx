// features/codex/ExtractorGuide.tsx -- what this pass is for, and what it is not
// ==============================================================================
// The "Show me how this works" for the Profile Extractor.
//
// It exists to answer one thing before a writer spends money: this hands you a
// DRAFT TO REWRITE, not a finished profile. That was the writer's own framing
// when they specified it, and it decides everything else -- if somebody expects
// accuracy they will judge it as wrong; if they expect a starting point they
// will judge it as hours saved.
//
// THE ORDER MATTERS MORE THAN ANY OTHER SCREEN IN THE APP, so two of these
// pages are about it. Weaving finds the names for free. This fills them in for
// money. Run it the other way round and you pay the most to get the noisiest
// possible result, then conclude the feature is bad.
//
// House style: no em dashes anywhere a writer reads.

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Page {
  title: string;
  body: React.ReactNode;
}

/** Text as the pass would propose it. Always labelled, so it is never mistaken
 *  for something the writer wrote or the app decided. */
function Proposed({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-weave-soft/60 bg-weave-fill/5 p-2">
      <p className="mb-1 text-micro uppercase tracking-wide text-weave">
        Proposed
      </p>
      <p className="text-xs text-text-primary">{children}</p>
    </div>
  );
}

/** What the writer already had. */
function Yours({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface p-2">
      <p className="mb-1 text-micro uppercase tracking-wide text-faint">
        What you have now
      </p>
      <p className="text-xs text-text-muted">{children}</p>
    </div>
  );
}

const PAGES: Page[] = [
  {
    title: "This gives you a draft to rewrite, not a finished profile",
    body: (
      <>
        <p>
          Filling in a story bible by hand means re-reading your own book and
          writing down what is already in it. For a long novel that can take
          longer than a chapter took to write, and it is the reason most
          writers never finish one.
        </p>
        <p>
          This does the reading. It comes back with an overview, traits,
          motivations and notes for every character, place, faction and
          creature it can find, and you keep the parts worth keeping.
        </p>
        <p className="text-text-primary">
          Expect to rewrite most of it. That is not a failure of the pass, it
          is the job: a model can tell you what your book SHOWS about someone,
          and only you know who they actually are.
        </p>
      </>
    ),
  },
  {
    title: "Run Weaving first. This is the part people get wrong",
    body: (
      <>
        <p>
          Weaving reads your manuscript for free and finds the NAMES in it,
          then helps you make an entry for each one. This pass is the opposite
          job: it takes the entries you already have and proposes what they
          should SAY.
        </p>
        <p>
          It works by sending a short extract of each of your entries along
          with the chapters, so it can add to what is there instead of starting
          over. With no entries, there is nothing to build on. It will propose
          a world from scratch, which is the most expensive request and the
          noisiest result you can get from it.
        </p>
        <p className="text-text-primary">
          Free pass first, paid pass second. In that order it is cheap and
          sharp; in the other order it is expensive and vague.
        </p>
      </>
    ),
  },
  {
    title: "It finds two kinds of character Weaving never can",
    body: (
      <>
        <p>
          Weaving looks for capitalised names, which means two ordinary ways of
          writing a person are invisible to it.
        </p>
        <p>
          <span className="text-text-primary">People described, not named.</span>{" "}
          "The tall man." "The hulking figure." "The woman with the burned
          hands." These are real characters with roles and reveals, and no rule
          about capital letters will ever find them, because deciding that "the
          tall man" is a person while "the long hallway" is not takes reading.
        </p>
        <p>
          <span className="text-text-primary">Names only ever spoken.</span>{" "}
          A name that only appears as somebody being addressed, like{" "}
          <span className="text-text-muted">"Duncan," he said</span>, sits where
          a capital letter was required anyway, so the scan cannot tell it from
          an ordinary word.
        </p>
        <p className="text-text-primary">
          A model reading your prose gets both right, and it keeps the
          description as the name. It never invents one.
        </p>
      </>
    ),
  },
  {
    title: "Nothing reaches your entry until you press a button on it",
    body: (
      <>
        <p>
          Every proposal is shown beside what that entry currently says, and
          each one has its own buttons. There is no accept-all, and nothing is
          ticked when the list arrives.
        </p>
        <p>
          That is deliberate, and it is worth knowing why. This pass does not
          quote your book or cite chapters, because an overview is a summary
          and has no single sentence behind it. So nothing has checked these
          proposals against anything.
        </p>
        <p className="text-text-primary">
          Your eye on each piece is the only check there is. Removing a click
          would remove the whole of it.
        </p>
      </>
    ),
  },
  {
    title: "Add to what you wrote, or replace it",
    body: (
      <>
        <p>Say your overview for Rosie already reads:</p>
        <Yours>
          A courier working the dock district. She grew up there and knows
          every shortcut.
        </Yours>
        <p>And the pass comes back with:</p>
        <Proposed>
          She counts the exits in every room she enters, and never sits with
          her back to a door.
        </Proposed>
        <p>
          <span className="text-text-primary">Add to what I wrote</span> leaves
          your two sentences exactly as they are and puts the new one after
          them. Nothing of yours is rewritten, reordered or blended in.
        </p>
        <p>
          <span className="text-text-primary">Replace mine</span> swaps yours
          out for the proposal. It is a separate button because it is a
          separate decision, and it is the only one that can lose your words.
        </p>
      </>
    ),
  },
  {
    title: "A trait can stand on its own, or fold into one of yours",
    body: (
      <>
        <p>
          Your profile already has a trait called{" "}
          <span className="text-text-primary">Wants out</span>, and the pass
          proposes <span className="text-text-primary">Owes a debt</span>.
          Those are two different things, so add it on its own.
        </p>
        <p>
          But if it proposes{" "}
          <span className="text-text-primary">Loyal to a fault</span> and you
          already have{" "}
          <span className="text-text-primary">Fiercely loyal</span>, you do not
          want both. Choose which of your traits it folds into, and the
          description is added to that one.
        </p>
        <p className="text-text-primary">
          You always pick the trait. The app never guesses which of your traits
          a proposal belongs to, because a wrongly folded trait still carries
          your own label and is very easy to miss later.
        </p>
      </>
    ),
  },
  {
    title: "It waits for you, for as long as you need",
    body: (
      <>
        <p>
          A whole novel produces a lot of proposals. You are not expected to
          get through them in one sitting, so the result is saved: close the
          app, come back next week, and the same list is there with everything
          you have already dealt with ticked off.
        </p>
        <p>
          There is only ever one saved read at a time. Running the pass again
          replaces it, and if you still have proposals you have not looked at,
          it will say how many before it does anything.
        </p>
        <p className="text-text-primary">
          One thing it will not tell you: whether your book has changed since
          the read. If you have rewritten half of it, run the pass again.
        </p>
      </>
    ),
  },
  {
    title: "When to reach for it",
    body: (
      <>
        <p>
          <span className="text-text-primary">The whole book, once.</span> The
          usual run, and best done when a draft is far enough along to be worth
          describing. Everything goes up as one request, which is what lets it
          notice that a character from chapter two came back in chapter eleven.
        </p>
        <p>
          <span className="text-text-primary">A few chapters, afterwards.</span>{" "}
          You have written three more chapters and a new faction turned up. Tick
          those chapters, tick "leave alone" against the characters you have
          already written up, and it will focus on what is new.
        </p>
        <p className="text-text-primary">
          What it is not for: checking your book for mistakes. That is Read the
          Cloth in Weaving, it is free, and it is better at it.
        </p>
      </>
    ),
  },
];

interface ExtractorGuideProps {
  onClose: () => void;
}

export function ExtractorGuide({ onClose }: ExtractorGuideProps) {
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
        aria-label="How the Profile Extractor works"
        data-testid="extractor-guide"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded border border-border bg-bg-primary"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold text-text-primary">{page.title}</h2>
          <span className="ml-auto text-mini text-faint">
            {index + 1} of {PAGES.length}
          </span>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-xs text-text-muted [&>p]:leading-relaxed">
          {page.body}
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-mini text-text-muted hover:text-text-primary disabled:opacity-30"
          >
            <ChevronLeft size={11} /> Back
          </button>
          {last ? (
            <button
              type="button" onClick={onClose}
              className="ml-auto rounded bg-weave-fill px-3 py-1 text-mini font-semibold text-white hover:bg-weave-fill"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex(i => Math.min(PAGES.length - 1, i + 1))}
              className="ml-auto inline-flex items-center gap-1 rounded bg-weave-fill px-3 py-1 text-mini font-semibold text-white hover:bg-weave-fill"
            >
              Next <ChevronRight size={11} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
