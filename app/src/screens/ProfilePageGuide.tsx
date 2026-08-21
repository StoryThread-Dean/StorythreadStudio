// screens/ProfilePageGuide.tsx -- what this page is, in the order it is in
// ========================================================================
// Asked for alongside the restructure: "We definitely need a Main 'WhatsThis'
// alongside the individual existing WhatsThis. Also a Show me how to do this
// full walkthrough first of the basics of each section. Then we can go into
// individual Show me how to do this subsections for different categories."
//
// So this is the FIRST walkthrough a writer meets on this page, and it is
// deliberately shallow. It says what each part is for and why it sits where it
// sits, in the order the page puts them, and hands off to the per-section guides
// for the depth. A first walkthrough that explained importance weights and
// subtext and frames would be the wall of information the restructure exists to
// remove.
//
// THE ORDER IS THE ARGUMENT. The writer's own words for the shape they wanted:
// "Tree Trunk > Main branches > Branches > Leaves ... give the Writer less
// instant Chaos." Each page below says why its part is where it is, because a
// writer who understands the order can find things without being taught them.

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface Page {
  title: string;
  body: React.ReactNode;
}

const PAGES: Page[] = [
  {
    title: "This page, top to bottom",
    body: (
      <>
        <p>
          An entry is built in the order you would explain the person to someone
          else, and you can stop at any point. Nothing below is required.
        </p>
        <ol className="ml-4 list-decimal space-y-1">
          <li><span className="text-text-primary">The basics</span> -- name, what they are to the story, sex, age.</li>
          <li><span className="text-text-primary">How this changes through the story</span> -- anything that becomes true at a point in the book.</li>
          <li><span className="text-text-primary">Connections</span> -- who they are to everyone else.</li>
          <li><span className="text-text-primary">Overview</span> -- who they are, in a few sentences.</li>
          <li><span className="text-text-primary">Traits</span> -- the detail, in tiles you open when you want them.</li>
        </ol>
        <p className="text-faint">
          Trunk first, then branches, then leaves. You are never asked for a leaf
          before a branch.
        </p>
      </>
    ),
  },
  {
    title: "The basics",
    body: (
      <>
        <p>
          Name, and what they are to the story. Role is the job they do in the
          book -- protagonist, mentor, the one who lies -- not their job in the
          world.
        </p>
        <p>
          <span className="text-text-primary">Age is written however you would
          say it.</span> "18 months", "18", "18ish", "approx 30", "Unknown", or
          nothing at all if it does not matter. It is not a number field and will
          not argue with you.
        </p>
        <p>
          Sex is M, F, or Custom, and Custom opens a box for your own word.
        </p>
      </>
    ),
  },
  {
    title: "How this changes through the story",
    body: (
      <>
        <p>
          The part no other screen can do, and the reason the Weave exists. The
          sections lower down are what is true THROUGHOUT. This is for what
          becomes true at a point in the book.
        </p>
        <p>
          "She believes her father died" is true from chapter one. "She learns he
          is alive" is true from chapter fifteen. Recorded here, the app can tell
          AI who someone was in chapter seven instead of who they end up being.
        </p>
        <p className="text-faint">
          Each one asks four short things and then collapses to a single line, so
          six of them read as six lines. It has its own walkthrough when you want
          the detail.
        </p>
      </>
    ),
  },
  {
    title: "Connections",
    body: (
      <>
        <p>
          Who this is to everyone else, shown as chips until you open them. Most
          of a scene runs on these rather than on anyone's traits.
        </p>
        <p>
          You do not have to build them by hand. Weaving reads your manuscript
          and offers connections it finds, and anything recorded there shows up
          here.
        </p>
        <p className="text-faint">
          Every connection carries one line saying WHY, in your words. That line
          is worth more to AI than the label on it.
        </p>
      </>
    ),
  },
  {
    title: "Overview",
    body: (
      <>
        <p>
          Who this is, in the two or three sentences you would give a co-writer
          before they read the book. Not a plot summary and not a biography.
        </p>
        <p>
          It sits after Connections on purpose: who somebody IS reads better once
          you have said who they are TO people.
        </p>
        <p>
          It is also the one section the app checks for. An entry with an empty
          Overview is what the Weave calls Frayed, and it is what a brief falls
          back on when nothing else fits.
        </p>
      </>
    ),
  },
  {
    title: "Traits",
    body: (
      <>
        <p>
          The detail, and the part that grows. Each trait is a tile: name,
          weight, and a line of what it means. Click one to open it, and it stays
          open while you work.
        </p>
        <p>
          Every trait answers two questions that have nothing to do with each
          other. <span className="text-text-primary">How much does this shape
          them</span> -- Core down to Contextual. And{" "}
          <span className="text-text-primary">may it be said out loud</span> --
          the eye beside the weight, for something AI should let drive behaviour
          and never name.
        </p>
        <p className="text-faint">
          Both have their own walkthrough on the Hidden and Foreshadowing
          section, including one secret written at three different weights so you
          can see what each produces.
        </p>
      </>
    ),
  },
  {
    title: "Where to start, and where to stop",
    body: (
      <>
        <p>
          A name and one line of Overview is a real entry. The app will use it,
          and nothing nags you for the rest.
        </p>
        <p>
          When you want more, the cheapest useful next step is usually a
          connection or two, because that is what a scene runs on. Traits are
          worth writing when a character starts behaving in ways you keep having
          to remember.
        </p>
        <p className="text-faint">
          Nothing here is saved until you press Save. That is true of every
          control on this page, including the ones that look like buttons.
        </p>
      </>
    ),
  },
];

interface ProfilePageGuideProps {
  onClose: () => void;
}

export function ProfilePageGuide({ onClose }: ProfilePageGuideProps) {
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
        aria-label="How this page works"
        data-testid="profile-page-guide"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-accent-fill bg-bg-panel"
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
              className="rounded bg-accent-fill px-3 py-1 text-xs font-semibold text-white hover:bg-accent-fill"
            >
              Done
            </button>
          ) : (
            <button
              onClick={() => setIndex(i => Math.min(PAGES.length - 1, i + 1))}
              className="inline-flex items-center gap-1 rounded bg-accent-fill px-3 py-1 text-xs font-semibold text-white hover:bg-accent-fill"
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
 *  by counting clicks. */
export const PROFILE_PAGE_GUIDE_TITLES = PAGES.map(p => p.title);
