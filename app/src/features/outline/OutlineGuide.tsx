// OutlineGuide.tsx -- "Show me how to do this", one page per section
// ===================================================================
// SEPARATE FROM "What's this?", ON PURPOSE. That panel answers four
// questions in a paragraph and floats beside the button. This is a
// walkthrough of nineteen sections, and hanging it underneath a hover panel
// would make a long read into a thing that vanishes when the mouse moves.
//
// EVERY SECTION GETS A PAGE, and every page gets THREE EXAMPLES from books a
// writer is likely to have read. An abstract definition of "Story Promise" is
// the kind of thing that sounds clear and teaches nothing; three of them from
// The Lord of the Rings, Harry Potter and Dungeon Crawler Carl are concrete
// enough to argue with, which is when a writer starts thinking about their
// own book instead of the definition.
//
// The three are chosen to be far apart -- epic fantasy, children's fantasy
// that turns dark, and a comic LitRPG -- so no page can be read as "this
// section is for books like X".
//
// WHY REAL BOOK NAMES ARE FINE HERE AND BANNED IN THE PRESETS. Preset bodies
// are written INTO notes/outline.md, where the Weave's scan reads capitalised
// words as names the writer has planned and the AI can be handed the file as
// context. Nothing on this screen is ever written anywhere: it is UI text a
// person reads and closes. See outline_presets.py for the rule that governs
// the other side of that line.
//
// House style: no em dashes anywhere a writer reads.

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Panel } from "../../components/ui/Panel";

interface Example {
  /** The book, so the writer can place the example instantly. */
  book: string;
  text: string;
}

interface Page {
  /** The group this section belongs to, shown above the title. */
  group?: string;
  title: string;
  /** What the section is for, in the app's own words. */
  what?: string;
  /** Why a writer would bother. Skipped where the title says it. */
  why?: string;
  examples?: Example[];
  /** Free-form, for the opening and closing pages. */
  body?: React.ReactNode;
}

const LOTR = "The Lord of the Rings";
const HP = "Harry Potter and the Philosopher's Stone";
const DCC = "Dungeon Crawler Carl";

const PAGES: Page[] = [
  {
    title: "The Outline is a page you type on",
    body: (
      <>
        <p>
          There is no form to fill in and nothing here is required. Write as
          much or as little as you want, in whatever order suits you.
        </p>
        <p>
          The header at the top is the only part the app reads, and only two
          lines of it: Target Word Count and Target Chapter Count feed your
          Writing Progress. Everything else in the header is there because it
          is useful to see while you plan.
        </p>
        <p>
          <strong>Add a section</strong> puts a ready-made section at the end
          of the file, with a prompt telling you what belongs there and one
          example showing the shape. Every example is labelled
          <em> delete this</em>, because it is meant to be deleted.
        </p>
        <p>
          A section you already have is greyed out in the list. Clicking it
          takes you to it. Rename or delete the heading and it becomes
          available again, because the list reads your outline rather than
          remembering what it handed you.
        </p>
        <p className="text-faint">
          The next nineteen pages are one per section: what it is for, and
          three examples from books you have probably read.
        </p>
      </>
    ),
  },

  // ── Story Core ─────────────────────────────────────────────────────────
  {
    group: "Story Core",
    title: "Premise",
    what: "Who wants what, and what stands in the way. One or two sentences.",
    why: "If this will not fit in two sentences, the book usually has two "
      + "stories in it and has not decided which one it is.",
    examples: [
      { book: LOTR, text: "A hobbit who has never left home has to carry a ring nobody is strong enough to use into the one country whose ruler is looking for it." },
      { book: HP, text: "An orphan kept in a cupboard learns he is famous in a world he has never heard of, and that the man who made him famous is not finished with him." },
      { book: DCC, text: "A man in his underwear and his ex-girlfriend's cat survive the demolition of Earth and have to keep descending a lethal dungeon on live broadcast." },
    ],
  },
  {
    group: "Story Core",
    title: "Story Promise",
    what: "What the opening promises the reader, and how the ending pays it off.",
    why: "Readers forgive almost anything except being promised one book and "
      + "handed another. Writing the promise down early is how you notice you "
      + "have drifted off it.",
    examples: [
      { book: LOTR, text: "Promised a long walk with terrible things at the edges of it. Paid off by the walk being the whole point, and the walking being what costs." },
      { book: HP, text: "Promised a school full of wonders. Paid off by the school turning out to be where the danger lives." },
      { book: DCC, text: "Promised a game show that kills people for entertainment. Paid off by the audience mattering as much as the monsters." },
    ],
  },
  {
    group: "Story Core",
    title: "Central Conflict",
    what: "The one pressure the whole book runs on. Name both sides of it.",
    why: "A book can have any number of problems. It usually only has one "
      + "engine, and scenes that are not connected to it are the ones that "
      + "feel slow.",
    examples: [
      { book: LOTR, text: "The Ring has to be destroyed, and the only place it can be destroyed is the one place its owner is watching." },
      { book: HP, text: "A boy wants to belong somewhere. The thing that makes him belong is the same thing that wants him dead." },
      { book: DCC, text: "Carl wants to survive. The system needs him entertaining, and playing it safe is not entertaining." },
    ],
  },
  {
    group: "Story Core",
    title: "Protagonist",
    what: "Goals, motivations, the main obstacle, and the stakes. Four short answers.",
    why: "Goals are what they are chasing; motivations are why they will not "
      + "stop. A character with a goal and no motivation reads as somebody "
      + "doing the plot a favour.",
    examples: [
      { book: LOTR, text: "Frodo. Get the Ring to the fire. Because nobody else can be trusted to carry it. The Ring itself, which gets heavier the closer he gets. If he fails, everything he was protecting is taken." },
      { book: HP, text: "Harry. Find out who he is. Because he has been told he is nobody his whole life. A school he does not know the rules of, and a man who has been waiting for him. If he fails, he goes back to the cupboard, or he dies." },
      { book: DCC, text: "Carl. Keep himself and the cat alive. Because she is the only thing left of the world he had. A dungeon designed so that survival alone is boring to watch. If he fails, he dies on camera and the show carries on." },
    ],
  },

  // ── Story Overview ─────────────────────────────────────────────────────
  {
    group: "Story Overview",
    title: "Story Summary",
    what: "The whole book in a paragraph, ending included. Tell it like you "
      + "would to a friend.",
    why: "Including the ending is the point. A summary that stops before it "
      + "is a blurb, and a blurb hides exactly the part you most need to have "
      + "decided.",
    examples: [
      { book: LOTR, text: "A ring of enormous power turns up in the quietest corner of the world. A hobbit carries it across a continent to destroy it, loses almost everything on the way, and at the last moment cannot do it. It is destroyed anyway, by the one creature more ruined by it than he is. He goes home and finds he no longer fits there." },
      { book: HP, text: "A boy is taken from an unhappy house to a school of magic, discovers he is famous for surviving something he cannot remember, makes his first friends, and works out that a teacher is trying to steal an object that grants eternal life. He stops him. The man behind it survives, and everyone knows it." },
      { book: DCC, text: "Earth is demolished to make way for a televised dungeon crawl. Carl and his cat enter as contestants, learn the rules are gameable and the audience is currency, and climb down through increasingly cruel floors. They survive the first one. There are a great many floors." },
    ],
  },
  {
    group: "Story Overview",
    title: "Beginning State",
    what: "How things stand before the story disturbs them. The ordinary that "
      + "is about to break.",
    why: "Readers cannot feel a loss they never saw intact. This is the thing "
      + "the rest of the book is measured against.",
    examples: [
      { book: LOTR, text: "The Shire, where nothing has happened for a very long time and everybody prefers it that way." },
      { book: HP, text: "A cupboard under the stairs, and a family who behave as though he is not there." },
      { book: DCC, text: "An ordinary cold night, an ex-girlfriend's cat, and no shoes." },
    ],
  },
  {
    group: "Story Overview",
    title: "Inciting Change",
    what: "The event that makes the story necessary. After it, going back is "
      + "not an option.",
    why: "If your character could still walk away after this, it has not "
      + "happened yet.",
    examples: [
      { book: LOTR, text: "Gandalf puts the ring in the fire and the writing comes up. It is not a trinket, and it is known to be here." },
      { book: HP, text: "The letters start arriving, and they do not stop no matter what his uncle does." },
      { book: DCC, text: "Every building on Earth comes down at once, and a voice explains the rules." },
    ],
  },
  {
    group: "Story Overview",
    title: "Escalating Change",
    what: "What gets worse, and in what order. Three or four steps is usually "
      + "enough.",
    why: "Order matters more than quantity. Escalation that does not escalate "
      + "is a series of incidents.",
    examples: [
      { book: LOTR, text: "Riders reach the Shire. Frodo is stabbed at Weathertop. The company loses Gandalf in Moria. Boromir tries to take the Ring, and the company breaks." },
      { book: HP, text: "A troll gets in. The Mirror shows him what he cannot have. The forest turns out to hold something drinking unicorn blood. The trapdoor is already open." },
      { book: DCC, text: "The floors get crueller, the audience gets larger, and the rules get rewritten whenever the crowd is bored." },
    ],
  },
  {
    group: "Story Overview",
    title: "Crisis",
    what: "The worst moment. The plan fails and the cost of carrying on "
      + "becomes clear.",
    why: "Not the biggest fight. The moment the character has to pay "
      + "something they were hoping to keep.",
    examples: [
      { book: LOTR, text: "Frodo stands at the Crack of Doom with the one job he has carried across the world, and refuses to do it." },
      { book: HP, text: "Harry goes through the trapdoor knowing no adult is coming, and comes out the far side of every obstacle alone." },
      { book: DCC, text: "The crowd's favour is the only thing keeping him alive, and staying alive means giving them something worse to watch." },
    ],
  },
  {
    group: "Story Overview",
    title: "Climax",
    what: "The confrontation everything has been aimed at. Say what is "
      + "decided, and by whom.",
    why: "By whom is the part writers skip. A climax the protagonist watches "
      + "is the most common way an ending goes flat.",
    examples: [
      { book: LOTR, text: "Gollum takes the Ring by force and falls with it. The mercy Frodo showed him hundreds of pages earlier is what destroys it." },
      { book: HP, text: "The Mirror gives the Stone to the only person in the room who does not want to use it." },
      { book: DCC, text: "Carl wins by understanding the rules better than the people who wrote them, in front of everybody." },
    ],
  },
  {
    group: "Story Overview",
    title: "Resolution",
    what: "The new ordinary. What changed, what did not, and what the reader "
      + "is left holding.",
    why: "This is where a book earns being remembered. It is also the section "
      + "most often left as a shrug.",
    examples: [
      { book: LOTR, text: "The Shire is saved and Frodo cannot live in it. The thing he protected is no longer a place he belongs." },
      { book: HP, text: "Back to the cupboard for the summer, but now with somewhere to go back to. The threat is not gone, and everybody knows it." },
      { book: DCC, text: "The floor is cleared. The next one opens. Nothing is over, and that is the promise." },
    ],
  },

  // ── Character Module ───────────────────────────────────────────────────
  {
    group: "Character Module",
    title: "Identity",
    what: "Name, role, age, race or gender, species or culture or faction.",
    why: "The flat facts, in one place, so you stop re-deciding them. This "
      + "section is repeatable: add one per character and it never greys out.",
    examples: [
      { book: LOTR, text: "Samwise Gamgee. Gardener, and the one who actually gets there. Thirty-eight. Male hobbit of the Shire, no house, no title." },
      { book: HP, text: "Hermione Granger. The one who knows things. Eleven. Muggle-born witch, Gryffindor." },
      { book: DCC, text: "Princess Donut. Carl's ex-girlfriend's cat, and a contestant in her own right. Persian. Extremely aware of her own status." },
    ],
  },
  {
    group: "Character Module",
    title: "Story Function",
    what: "What this character is for. What would break if you cut them.",
    why: "The most useful question you can ask about a supporting cast. If "
      + "the answer is 'nothing', you have found a scene to shorten. "
      + "Repeatable, one per character.",
    examples: [
      { book: LOTR, text: "Sam is the reason Frodo arrives at all. Cut him and the Ring never reaches the mountain, because Frodo stops being able to carry it long before the end." },
      { book: HP, text: "Hermione is the one who knows things. Cut her and the three of them die at the first obstacle under the trapdoor." },
      { book: DCC, text: "Donut is who Carl is human at. Cut her and he is a man narrating his own death to nobody." },
    ],
  },

  // ── Structure ──────────────────────────────────────────────────────────
  {
    group: "Structure",
    title: "Act Beats",
    what: "The three acts in a line each: setup and the inciting change, "
      + "escalation and the crisis, climax and resolution.",
    why: "A rough shape you can look at in one glance. Useful for spotting a "
      + "second act that is doing nothing, which is where books usually sag.",
    examples: [
      { book: LOTR, text: "One, the Ring is identified and has to leave the Shire. Two, the company forms, crosses a continent and breaks apart. Three, two hobbits finish the job alone while a war distracts the enemy." },
      { book: HP, text: "One, Harry is collected and learns what he is. Two, a year of school, with something moving underneath it. Three, three children go through the trapdoor." },
      { book: DCC, text: "One, Earth ends and the rules are announced. Two, floor by floor, learning what the system rewards. Three, the boss, and an audience deciding whether he lives." },
    ],
  },
  {
    group: "Structure",
    title: "Midpoint",
    what: "The turn in the middle. Something is learned or lost that changes "
      + "what the protagonist is TRYING to do, not just how hard it is.",
    why: "A midpoint that only raises the difficulty is not a midpoint. The "
      + "goal itself should be different on the far side of it.",
    examples: [
      { book: LOTR, text: "Gandalf falls in Moria. The company stops being escorted by someone who knows what he is doing and starts making its own decisions." },
      { book: HP, text: "The Mirror of Erised. The danger stops being the dark corridors and becomes wanting something badly enough to sit in front of it forever." },
      { book: DCC, text: "Carl works out that the audience is the real currency. Surviving stops being the goal; being worth watching does." },
    ],
  },

  // ── World Module ───────────────────────────────────────────────────────
  {
    group: "World Module",
    title: "Setting Sketch",
    what: "Where and when. The three or four facts a reader needs before "
      + "anything else makes sense.",
    why: "Three or four. This is the orientation, not the encyclopedia -- the "
      + "rest of your world lives in The Weave, where each piece can be "
      + "attached to the scenes that need it.",
    examples: [
      { book: LOTR, text: "Middle-earth at the end of an age. The great powers are tired, the elves are leaving, and most people have no idea any of that is happening." },
      { book: HP, text: "Modern Britain with a boarding school of magic hidden inside it, kept secret by law from everyone else." },
      { book: DCC, text: "Earth, twelve hours after it stopped being Earth. Everything above ground is gone and everything below it is a broadcast." },
    ],
  },
  {
    group: "World Module",
    title: "Rules and Limits",
    what: "What can and cannot happen here, and what it costs.",
    why: "Limits, not abilities. A world where anything is possible has no "
      + "tension in it, because no obstacle is real.",
    examples: [
      { book: LOTR, text: "The Ring cannot be used, only carried. Anyone strong enough to use it becomes the thing they were fighting, so using it is the same as losing." },
      { book: HP, text: "Magic needs a wand, the words, and training. Underage magic outside school is detected. Nothing brings back the dead." },
      { book: DCC, text: "The dungeon's rules are published, gameable, and rewritten by the producers the moment they stop being entertaining." },
    ],
  },
  {
    group: "World Module",
    title: "Factions and Powers",
    what: "Who holds power, who wants it, and what each would do to keep or "
      + "take it.",
    why: "Written down as a list, it becomes obvious which of your factions "
      + "has no reason to appear in the book.",
    examples: [
      { book: LOTR, text: "Gondor, holding a border with no king. Rohan, strong and badly advised. Mordor, patient. Isengard, defecting. The elves, leaving rather than fighting." },
      { book: HP, text: "The Ministry, which would rather nothing happened. The school's four houses, competing over everything. And the followers of a man everyone insists is dead." },
      { book: DCC, text: "The producers, who own the rules. The sponsors, who buy influence over them. The other crawlers, who are competition and audience at once." },
    ],
  },

  // ── Chapter Plan ───────────────────────────────────────────────────────
  {
    group: "Chapter Plan",
    title: "Chapter Plan",
    what: "One or two lines per chapter. You do not have to plan them all.",
    why: "Plenty of writers plan the next three chapters and no further. The "
      + "section is there for whichever of those you are.",
    examples: [
      { book: LOTR, text: "1: a long-expected party, and a ring changes hands. 2: Gandalf returns and tells Frodo what he is holding. 3: they leave the Shire at night and are followed." },
      { book: HP, text: "1: a baby is left on a doorstep. 2: ten years later, a boy in a cupboard. 3: the letters start arriving." },
      { book: DCC, text: "1: an ordinary night, and then no buildings. 2: the rules, announced to whoever is left. 3: the first floor, and the first thing that tries to kill him." },
    ],
  },

  {
    title: "That is all nineteen",
    body: (
      <>
        <p>
          You do not need most of them. Writers who plan heavily use eight or
          ten; writers who discover as they go often use two, and that is a
          complete answer.
        </p>
        <p>
          If you want a place to start: <strong>Premise</strong> and{" "}
          <strong>Central Conflict</strong> are the two that tend to change
          how the rest of the book gets written, because they force a decision
          rather than a description.
        </p>
        <p>
          Everything you add is ordinary Markdown in your own file. Rename the
          headings, reorder them, delete the ones that stop being useful. The
          section list reads whatever is actually there, so it keeps up.
        </p>
        <p className="text-faint">
          People and places belong in The Weave rather than here. The Outline
          is for the shape of the book; The Weave is for who is in it and what
          is true when.
        </p>
      </>
    ),
  },
];

interface OutlineGuideProps {
  onClose: () => void;
}

export function OutlineGuide({ onClose }: OutlineGuideProps) {
  const [index, setIndex] = useState(0);
  const page = PAGES[index];
  const last = index === PAGES.length - 1;

  return (
    <Dialog
      label="How the Outline works"
      testId="outline-guide"
      size="lg"
      onClose={onClose}
      title={
        <div className="min-w-0">
          {page.group && (
            <p className="text-micro uppercase tracking-label text-accent">
              {page.group}
            </p>
          )}
          <span className="block truncate">{page.title}</span>
        </div>
      }
      footer={
        <>
          <Button
            variant="bare"
            size="sm"
            icon={<ChevronLeft size={11} />}
            disabled={index === 0}
            onClick={() => setIndex(i => Math.max(0, i - 1))}
          >
            Back
          </Button>
          <span
            className="ml-auto text-mini text-text-muted"
            data-testid="outline-guide-progress"
          >
            Page {index + 1} of {PAGES.length}
          </span>
          {last ? (
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIndex(i => Math.min(PAGES.length - 1, i + 1))}
            >
              Next <ChevronRight size={11} />
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-xs text-text-muted [&>p]:leading-relaxed">
        {page.body}

        {page.what && <p className="text-text-primary">{page.what}</p>}
        {page.why && <p>{page.why}</p>}

        {page.examples && (
          <div className="space-y-2 pt-1">
            <p className="text-micro uppercase tracking-label text-text-muted">
              How three books you know answer it
            </p>
            {page.examples.map(ex => (
              <Panel key={ex.book} level="inset" padding="sm">
                <p className="mb-1 text-micro font-semibold text-accent">
                  {ex.book}
                </p>
                <p className="text-mini leading-relaxed text-text-primary">
                  {ex.text}
                </p>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
