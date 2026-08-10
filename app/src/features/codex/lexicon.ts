// features/codex/lexicon.ts -- every word the Weave uses, explained once
// =======================================================================
// The Weave introduces a vocabulary: Threads, Ties, Runs, Snags, Loose
// threads. Invented words earn their keep only if the app teaches them, and
// the app can only teach them consistently if there is ONE place that says
// what each one means.
//
// So every term lives here with four things:
//
//   Icon     so it is recognisable before it is read
//   short    one line, for a tooltip or a legend row
//   does     what it DOES for the writer, in second person
//   whatsThis 2-4 sentences behind a disclosure, for when one line is not enough
//
// The map legend, the sidebar, the walk rail and every tooltip render from
// this file. A term that appears on screen with no entry here fails the
// build (see lexicon.test.ts) -- because the alternative is a writer meeting
// the word "Snag" in a heading with nothing to click.
//
// NOTE: whatsThis is a plain string rather than a ReactNode. The design
// sketch had it as JSX, but a string keeps this file importable by tests
// without a renderer, and nothing here has needed markup.

import {
  AlertTriangle, BookOpen, CalendarClock, CalendarOff, CircleDashed, Compass,
  Flag, Gauge, GitMerge, Heart, History, Lightbulb, Link2, MapPin, Network,
  Package, Sparkles, Unlink, Unplug, User, Waypoints,
  type LucideIcon,
} from "lucide-react";

export type Tone = "emerald" | "amber" | "rose" | "blue" | "violet" | "zinc";

export interface LexEntry {
  /** What the writer reads. */
  term: string;
  /** What the code calls it. Never shown. */
  code: string;
  Icon: LucideIcon;
  tone: Tone;
  /** One line -- tooltips, legend rows, collapsed lists. */
  short: string;
  /** What it does FOR YOU. Second person, present tense. */
  does: string;
  /** The longer answer, behind "What's this?". */
  whatsThis: string;
}

function entry(
  code: string, term: string, Icon: LucideIcon, tone: Tone,
  short: string, does: string, whatsThis: string,
): LexEntry {
  return { code, term, Icon, tone, short, does, whatsThis };
}

// ── The structure of the Weave ───────────────────────────────────────────────

export const CONCEPTS: Record<string, LexEntry> = {
  weave: entry(
    "codex", "the Weave", Network, "violet",
    "Everything in your world, and how it all connects.",
    "It holds your characters, places, factions and ideas in one place, and knows how they relate to each other.",
    "The Weave is your world model. Every character, place, faction, object and idea is a Thread in it, and the connections between them are Ties. "
    + "What makes it more than a folder of notes is that it knows WHEN things are true -- so it can answer 'who was she in chapter 7?' rather than "
    + "describing one unchanging person from page one to the last page.",
  ),
  thread: entry(
    "entity", "Thread", User, "blue",
    "One entry in your world -- a person, place, faction or idea.",
    "It gathers everything you know about one thing, and everything that thing connects to.",
    "A Thread is one entry. It has your own writing in it -- description, motivations, notes -- plus its Ties to other Threads and its Run, "
    + "which records how it changes across the story. Threads are ordinary Markdown files, so copying your project folder takes the whole world with it.",
  ),
  tie: entry(
    "link", "Tie", Link2, "emerald",
    "A connection between two Threads.",
    "It records how two things relate -- who mentored whom, who rules where, which faction is at war with which.",
    "A Tie is a typed connection: mentored by, member of, at war with. It is stored on one side only and read from both, so you never have to "
    + "record the same relationship twice. A Tie can also have a point in the story where it becomes true, and one where it stops -- so an "
    + "alliance formed in chapter nine reads correctly before and after.",
  ),
  run: entry(
    "timeline", "Run", History, "amber",
    "How a Thread changes across the story.",
    "It is what lets the app tell your AI who someone was at a given chapter, rather than who they end up being.",
    "A Thread's Run is a list of facts, each pinned to a point in the story. A character who believes her father died in a raid, and learns "
    + "otherwise in chapter fourteen, has both facts in her Run. Ask about chapter seven and you get the belief; ask about chapter fifteen and "
    + "you get the truth. Nothing else in the app works this way, and it is the whole reason the Weave exists.",
  ),
  weaving: entry(
    "walkthrough", "Weaving", Waypoints, "violet",
    "A guided session that helps you fill the Weave in.",
    "It reads what you have written, finds what is missing or contradictory, and walks you through it one decision at a time.",
    "Weaving is optional. It looks at your manuscript and your Weave together and offers you things to decide: a name that has no Thread, "
    + "a connection your prose implies but nothing records, two facts that disagree. You apply, skip, or say 'not this' -- nothing is ever "
    + "changed without you.",
  ),
};

// ── What Weaving finds ───────────────────────────────────────────────────────
// Not used until the walkthrough ships, but defined here so the vocabulary is
// decided in one pass rather than invented twice.

export const STOP_KINDS: Record<string, LexEntry> = {
  "missing-entity": entry(
    "missing-entity", "Unspun", CircleDashed, "blue",
    "A name in your prose with no Thread behind it.",
    "It offers to make an entry for someone your story already mentions.",
    "Your manuscript refers to a person, place or thing that has no entry in the Weave. That is often fine -- an innkeeper with one line "
    + "does not need a profile -- so you can say it is not a real entry and it will never ask again.",
  ),
  "thin-entity": entry(
    "thin-entity", "Frayed", Gauge, "amber",
    "A Thread too thin to be much use.",
    "It shows you what is missing and offers to fill it from what you have already written.",
    "An entry exists but has almost nothing in it. A Thread with just a name cannot help your AI write the character, and cannot tell you "
    + "anything you did not already know. This points at the gaps, one field at a time.",
  ),
  "unlinked": entry(
    "unlinked", "Untied", Unlink, "emerald",
    "A connection your writing asserts that nothing records.",
    "It spots relationships in your prose and offers to record them, so the app knows about them too.",
    "Your text says Garrick taught her everything, but no Tie says so. This proposes the connection with the sentence it came from, and lets "
    + "you correct the relationship, flip its direction, or say when it became true before you accept it.",
  ),
  "undated-fact": entry(
    "undated-fact", "Unplaced", CalendarOff, "amber",
    "A fact with no point in the story.",
    "It asks where in your book something became true, so the app can tell your AI when it applies.",
    "A fact without a point in the story is true everywhere or nowhere, and the app cannot reason about it. This gathers them into a list so "
    + "you can place the ones that matter and leave the rest.",
  ),
  "unasked-rule": entry(
    "unasked-rule", "Unwoven", Compass, "violet",
    "Ground rules of your world you have not worked out yet.",
    "It asks questions about how your world works, and each answer opens the next ones.",
    "How does power pass? What is forbidden, and by whom? Answering one question opens the questions it implies and connects to others in "
    + "different areas -- so a decision about succession reaches into your laws and your religion. Every answer becomes part of the Weave.",
  ),
  "contradiction": entry(
    "contradiction", "Snag", AlertTriangle, "rose",
    "Two things in your world that disagree.",
    "It catches continuity problems, including a character acting on something they do not know yet.",
    "A Snag is two facts that cannot both be true: a status set twice at the same moment, an event referenced before it happens, or a "
    + "character who knows something the story has not told them. Some contradictions are deliberate, and you can mark them so -- the check "
    + "will not raise them again.",
  ),
  "contradiction-cluster": entry(
    "contradiction-cluster", "Tangle", GitMerge, "rose",
    "Several Snags with one cause behind them.",
    "It shows you the root problem instead of five separate symptoms of it.",
    "When several contradictions share an entry or a fact, they are usually one mistake seen from different angles. A Tangle groups them so "
    + "you fix the cause rather than the symptoms.",
  ),
  "orphan": entry(
    "orphan", "Loose thread", Unplug, "zinc",
    "A Thread nothing connects to.",
    "It points out entries that are not part of your world yet, and what each would need to be.",
    "An entry with no Ties and no mentions is floating free. Sometimes that is right -- something you have planned but not used -- and "
    + "sometimes it means you forgot to connect it. On the map they sit at the rim with nothing attached, which is the clearest possible "
    + "statement of the problem.",
  ),
};

// ── Kinds of Thread ──────────────────────────────────────────────────────────
// Icons and tones for the nine built-in types. A writer's own custom type
// falls back to a neutral entry rather than crashing or rendering blank.

const TYPE_ICONS: Record<string, [LucideIcon, Tone, string]> = {
  character:    [User,          "blue",    "A person in your story."],
  relationship: [Heart,         "rose",    "How two people stand with each other."],
  location:     [MapPin,        "emerald", "A place."],
  lore:         [BookOpen,      "amber",   "History, myth, or background."],
  faction:      [Flag,          "violet",  "A group with its own interests."],
  religion:     [Sparkles,      "violet",  "A faith and its practices."],
  object:       [Package,       "zinc",    "A thing that matters."],
  concept:      [Lightbulb,     "amber",   "An idea, rule, or force."],
  event:        [CalendarClock, "rose",    "Something that happened."],
};

export function threadTypeEntry(typeId: string, label?: string): LexEntry {
  const known = TYPE_ICONS[typeId];
  const term = label || typeId.replace(/_/g, " ");
  if (!known) {
    // A custom type the writer added. It still gets an icon and a name --
    // rendering a blank because we have never heard of it would punish them
    // for using a feature we built.
    return entry(typeId, term, CircleDashed, "zinc",
      `A ${term} in your world.`,
      `It holds everything you know about one ${term}.`,
      `${term} is a kind of entry you added to this world. It behaves like any other Thread: it can carry Ties, a Run, and your own notes.`);
  }
  const [Icon, tone, short] = known;
  return entry(typeId, term, Icon, tone, short,
    `It gathers what you know about one ${term} and what it connects to.`,
    CONCEPTS.thread.whatsThis);
}

/** Look up any term by its code. Concepts and stop kinds share one namespace
 *  because the UI does not care which list a word came from. */
export function lex(code: string): LexEntry | undefined {
  return CONCEPTS[code] ?? STOP_KINDS[code]
    ?? Object.values(CONCEPTS).find(e => e.code === code)
    ?? Object.values(STOP_KINDS).find(e => e.code === code);
}

/** The nine built-in Thread types, for the map legend. */
export const BUILT_IN_TYPES = Object.keys(TYPE_ICONS);

/** Tailwind classes per tone, so colour is decided once. Kept as full class
 *  strings rather than interpolated names -- Tailwind only ships classes it
 *  can see written out. */
export const TONE_CLASSES: Record<Tone, { text: string; fill: string; border: string }> = {
  emerald: { text: "text-emerald-300", fill: "fill-emerald-400", border: "border-emerald-700" },
  amber:   { text: "text-amber-300",   fill: "fill-amber-400",   border: "border-amber-700" },
  rose:    { text: "text-rose-300",    fill: "fill-rose-400",    border: "border-rose-700" },
  blue:    { text: "text-blue-300",    fill: "fill-blue-400",    border: "border-blue-700" },
  violet:  { text: "text-violet-300",  fill: "fill-violet-400",  border: "border-violet-700" },
  zinc:    { text: "text-zinc-300",    fill: "fill-zinc-400",    border: "border-zinc-700" },
};
