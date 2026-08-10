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
  AlertTriangle, Anchor, Atom, Bird, BookOpen, Bot, Brain, Bug, CalendarClock,
  CalendarOff, Castle, Church, CircleDashed, Clock, Cog, Coins, Compass, Crown,
  Drama, Eye, Feather, FileSearch, FileText, Fish, Flag, Flame, FlaskConical,
  Footprints, Gem, Ghost, GitMerge, Hammer, Heart, History, Key,
  Landmark, Languages, Leaf, Lightbulb, Link2, ListTree, Map, MapPin, Moon,
  Mountain, Music, Network, NotebookPen, Package, Paintbrush, PawPrint,
  Pickaxe, Rocket, Scale, ScrollText, Shield, Ship, Skull, Snowflake, Sparkles,
  Pin, Scissors, Spline, Spool, Star, Sun, Sword, Swords, Tent, Trees, Unlink,
  User, Users, Wand, Waves, Wheat, Zap,
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
    "walkthrough", "Weaving", Spool, "violet",
    "A guided session that helps you fill the Weave in.",
    "It reads what you have written, finds what is missing or contradictory, and walks you through it one decision at a time.",
    "Weaving is optional. It looks at your manuscript and your Weave together and offers you things to decide: a name that has no Thread, "
    + "a connection your prose implies but nothing records, two facts that disagree. You apply, skip, or say 'not this' -- nothing is ever "
    + "changed without you.",
  ),
};

// ── The three groups, explained ──────────────────────────────────────────────
//
// Each has a "What's this?" in the Add New window, and each answers the same
// four questions in the same order, because a writer meeting one of these
// for the first time needs all four and nothing else:
//
//   1. what the Weave is, briefly -- the context everything else sits in
//   2. what THIS group is, and how to tell it from the other two
//   3. what lives in it, and why each of those is worth keeping
//   4. what happens next: how Weaving stitches it into the story
//
// The last one matters most and is the easiest to leave out. Filling in a
// form is a chore unless you know what the app will DO with it, and the
// answer -- that your AI will know who someone was in chapter seven, not
// just who they end up being -- is the whole reason any of this exists.

/**
 * One line of a guide.
 *
 * STRUCTURED RATHER THAN PROSE, deliberately. Written as one paragraph this
 * is a wall of text nobody reads, and the list of kinds -- the part a writer
 * is actually scanning for -- is buried mid-sentence. Breaking it into lines
 * with the term pulled to the front means the answer to "what can I put
 * here?" can be found without reading anything.
 *
 * `term` is emphasised and leads the line. `text` may carry mid-sentence
 * emphasis with *asterisks*. Both are data rather than markup a renderer has
 * to guess at, so the styling is decided once.
 */
export interface GuideLine {
  /** Emphasised, at the start of the line. */
  term?: string;
  /** The rest. *Asterisks* mark inline emphasis. */
  text: string;
  /** A kind within this group, indented under the lines above it. */
  indent?: boolean;
}

export const GROUP_GUIDES: Record<string, GuideLine[]> = {
  notes: [
    { term: "The Weave", text: "is everything in your world and how it all connects." },
    { term: "NOTES", text: "is the part you write yourself: documents in your own voice, kept as ordinary files you can open anywhere." },
    { term: "Author Notes", text: "for any loose thought that has nowhere else to go yet.", indent: true },
    { term: "Outline", text: "for where the story is going, act by act.", indent: true },
    { term: "Style Guide", text: "for the rules that keep the prose sounding like yours.", indent: true },
    { term: "Brainstorming", text: "for the ideas that are not ready to be decisions.", indent: true },
    { term: "Research", text: "for what you have gathered and will need to reach for.", indent: true },
    { term: "Themes", text: "for what the book is actually about underneath the plot.", indent: true },
    { text: "The difference from Profiles is simple: a note is something you *write*. A profile is an entry *about* something. If you find yourself describing a person or a place, that belongs in Profiles instead." },
    { term: "Something else...", text: "lets you add a document of your own: *Dungeon Rules*, *Magic Costs*, whatever this book needs. It appears in the sidebar the moment you make it." },
    { text: "Every note you keep is a thread laid down. *WEAVING* is the step that picks them up -- it reads what you have written, finds where your notes and your chapters disagree or leave a gap, and stitches them together, so the AI helping you write chapter twelve knows what you decided in chapter two." },
  ],

  profiles: [
    { term: "The Weave", text: "is everything in your world and how it all connects." },
    { term: "PROFILES", text: "is the part that is about the things *in* it. A profile is an entry about one thing: a Character, a Location, a piece of Lore. Add more as your world grows." },
    { term: "Factions", text: "for groups with their own interests.", indent: true },
    { term: "Religions", text: "for what people believe.", indent: true },
    { term: "Governments", text: "for who holds power and how it passes.", indent: true },
    { term: "Deities", text: "for what is worshipped.", indent: true },
    { term: "Creatures", text: "for what lives out there.", indent: true },
    { term: "Cultures", text: "for how a people live: the food they eat, how they treat their neighbours, how they behave in a place that is not theirs.", indent: true },
    { term: "Relationships", text: "for how two people stand with each other.", indent: true },
    { text: "You do not need all of them. A quiet domestic novel may never want a Government; an epic fantasy will want most of them. They stay out of your way until you ask for them." },
    { text: "What makes a profile more than a note is that it can *CHANGE*. A character who believes her father died in a raid, and learns otherwise in chapter fourteen, is a different person before and after -- and the Weave records both, pinned to where in the story each became true." },
    { term: "Something else...", text: "lets you add a kind of your own: a *Bloodline*, a *Guild*, a *Starship class*. It behaves exactly like the ones we ship with." },
    { text: "Each profile is a thread; the connections between them are ties. *WEAVING* is the step that pulls them tight -- it reads your chapters, spots the people your prose mentions but your world does not know about, the relationships your writing implies but nothing records, and the places two facts disagree. Stitch by stitch, the pieces become one cloth." },
  ],

  other: [
    { term: "The Weave", text: "is everything in your world and how it all connects." },
    { term: "OTHER", text: "is for the pieces that are neither a document you wrote nor a profile of somebody." },
    { term: "Events", text: "for things that happened: a battle, a coronation, the night everything changed.", indent: true },
    { term: "Objects", text: "for things that matter enough to follow: a crown, a letter, a weapon.", indent: true },
    { term: "Concepts", text: "for the ideas and rules your world runs on, including how its magic or technology works and what it costs.", indent: true },
    { term: "Languages", text: "for the tongues, scripts and names that make a place sound like itself.", indent: true },
    { text: "These are the pieces writers most often keep in their head and then contradict three hundred pages later. Writing them down here is what stops that." },
    { term: "Something else...", text: "lets you add anything the shipped kinds do not cover. If a word in the name is one we recognise, you may find the section arrives with an icon of its own." },
    { text: "An Event is a thread with a place in *time*, which is what makes the rest of the Weave work: once the app knows *when* something happened, it can tell you who knew what, and when. *WEAVING* is the step that ties these into the story -- finding the moment your prose refers to something that has not happened yet, or a character acting on news nobody has given them." },
  ],
};

/** A guide as one flat string. For tests, and for anywhere that wants to
 *  search the words without caring how they are laid out. */
export function guidePlainText(lines: GuideLine[]): string {
  return lines
    .map(line => `${line.term ? line.term + " " : ""}${line.text}`.replace(/\*/g, ""))
    .join(" ");
}

// ── What Weaving finds ───────────────────────────────────────────────────────
// KEYED BY THE WIRE CODE the backend's scan actually sends -- "unspun", not
// "missing-entity". The two sides used to use different words for the same
// thing, which reads as harmless right up until a stop arrives with a kind
// nothing on this side has an entry for and renders as a blank row. A
// contract test pins that every kind codex/scan.py can produce is in here.
//
// Some entries here have no deterministic producer yet (Untied and Unwoven
// come from the AI and canned passes; Tangle is a grouping). They stay
// because the vocabulary was decided in one pass rather than invented twice.

// THE ICONS ARE THE LOOM, DELIBERATELY. Weaving is a Spool, Unspun is a sheaf
// of unspun fibre, Frayed is a sewing implement, Loose thread is a curve
// with its end hanging free. The first set reached for whatever was nearest --
// a circuit-board Waypoints for Weaving, a car-dashboard Gauge for Frayed, a
// power plug for Loose thread -- and a writer reads those as some other app's
// vocabulary leaking through. The metaphor is the whole point of the feature's
// name; the icons have to carry it.
export const STOP_KINDS: Record<string, LexEntry> = {
  "unspun": entry(
    "unspun", "Unspun", Wheat, "blue",
    "A name in your prose with no Thread behind it.",
    "It offers to make an entry for someone your story already mentions.",
    "Your manuscript refers to a person, place or thing that has no entry in the Weave. That is often fine -- an innkeeper with one line "
    + "does not need a profile -- so you can say it is not a real entry and it will never ask again.",
  ),
  "frayed": entry(
    "frayed", "Frayed", Scissors, "amber",
    "A Thread too thin to be much use.",
    "It shows you what is missing and offers to fill it from what you have already written.",
    "An entry exists but has almost nothing in it. A Thread with just a name cannot help your AI write the character, and cannot tell you "
    + "anything you did not already know. This points at the gaps, one field at a time.",
  ),
  "untied": entry(
    "untied", "Untied", Unlink, "emerald",
    "A connection your writing asserts that nothing records.",
    "It spots relationships in your prose and offers to record them, so the app knows about them too.",
    "Your text says Garrick taught her everything, but no Tie says so. This proposes the connection with the sentence it came from, and lets "
    + "you correct the relationship, flip its direction, or say when it became true before you accept it.",
  ),
  "unplaced": entry(
    "unplaced", "Unplaced", CalendarOff, "amber",
    "A fact with no point in the story.",
    "It asks where in your book something became true, so the app can tell your AI when it applies.",
    "A fact without a point in the story is true everywhere or nowhere, and the app cannot reason about it. This gathers them into a list so "
    + "you can place the ones that matter and leave the rest.",
  ),
  "unwoven": entry(
    "unwoven", "Unwoven", Compass, "violet",
    "Ground rules of your world you have not worked out yet.",
    "It asks questions about how your world works, and each answer opens the next ones.",
    "How does power pass? What is forbidden, and by whom? Answering one question opens the questions it implies and connects to others in "
    + "different areas -- so a decision about succession reaches into your laws and your religion. Every answer becomes part of the Weave.",
  ),
  "snag": entry(
    "snag", "Snag", AlertTriangle, "rose",
    "Two things in your world that disagree.",
    "It catches continuity problems, including a character acting on something they do not know yet.",
    "A Snag is two facts that cannot both be true: a status set twice at the same moment, an event referenced before it happens, or a "
    + "character who knows something the story has not told them. Some contradictions are deliberate, and you can mark them so -- the check "
    + "will not raise them again.",
  ),
  "tangle": entry(
    "tangle", "Tangle", GitMerge, "rose",
    "Several Snags with one cause behind them.",
    "It shows you the root problem instead of five separate symptoms of it.",
    "When several contradictions share an entry or a fact, they are usually one mistake seen from different angles. A Tangle groups them so "
    + "you fix the cause rather than the symptoms.",
  ),
  pinned: entry(
    "pinned", "Pinned", Pin, "violet",
    "Something you marked yourself, to come back to.",
    "It holds a word in place until you decide what it is, without you having to decide now.",
    "You selected a word and marked it, so Weaving will ask you about it. Marking does not make a connection -- there is nothing to get wrong yet, and nothing "
    + "to connect it to is a perfectly good reason to mark it. It is the same idea as pinning a piece of fabric before you stitch it: the pin holds it in place "
    + "until the real join is made. It stays here until you answer it, because nothing found it. You did.",
  ),
  early_mention: entry(
    "early_mention", "Told early", Clock, "amber",
    "Something named in your book before the reader is meant to meet it.",
    "It catches a name that slipped into an earlier chapter than the one that introduces it.",
    "Everything you have anchored about this Thread happens later than the chapter that names it, so the map hides it at that point in the "
    + "book while your prose says it out loud. Either the mention is early, or the anchors are -- both are worth knowing, and only you can "
    + "say which. It can only happen on Threads you have actually dated, so it never nags a world you have not anchored yet.",
  ),
  "loose_thread": entry(
    "loose_thread", "Loose thread", Spline, "zinc",
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

// WHICH icon a kind uses is decided in ONE place -- the type registry, which
// stores a name like "Landmark". This map only turns that name into a
// component, because a bundler cannot tree-shake a dynamic import and lucide
// ships thousands of icons.
//
// That split matters. This file used to keep its OWN list of types, which
// promptly fell behind the backend: four kinds were added there and rendered
// with the fallback icon, and the contract test missed it because it checked
// this file against ITSELF. A name-to-component map cannot drift that way --
// a kind the registry adds works immediately, and an icon name nobody has
// imported degrades to the fallback rather than vanishing.
// Every name the backend can store must be here, including the ones the
// keyword easter egg produces -- a surprise that renders as a blank square
// is worse than no surprise. tests/test_codex_icon_keywords.py reads THIS
// object and fails if the backend can emit a name it does not contain,
// because a cross-language contract nothing verifies is one that quietly
// breaks.
const ICONS: Record<string, LucideIcon> = {
  // Shipped kinds and note documents
  User, Heart, MapPin, BookOpen, Flag, Sparkles, Landmark, Sun, PawPrint,
  Drama, Package, Lightbulb, CalendarClock, Languages,
  NotebookPen, ListTree, Feather, Brain, FileSearch, Paintbrush, FileText,
  CircleDashed,
  // Keyword matches for kinds a writer invents
  Anchor, Atom, Bird, Bot, Bug, Castle, Church, Clock, Cog, Coins, Compass,
  Crown, Eye, Fish, Flame, FlaskConical, Footprints, Gem, Ghost, Hammer, Key,
  Leaf, Map, Moon, Mountain, Music, Pickaxe, Rocket, Scale, ScrollText,
  Shield, Ship, Skull, Snowflake, Star, Sword, Swords, Tent, Trees, Users,
  Wand, Waves, Wheat, Zap,
};

/** Colour and a one-line description per shipped kind. Anything not listed
 *  gets a neutral tone, which is what a writer's own kind should look like. */
const TYPE_TONES: Record<string, [Tone, string]> = {
  character:    ["blue",    "The people in your story."],
  relationship: ["rose",    "How two people stand with each other."],
  location:     ["emerald", "The places your story happens in."],
  lore:         ["amber",   "History, myth, and background."],
  faction:      ["violet",  "Groups with interests of their own."],
  religion:     ["violet",  "Faiths and their practices."],
  government:   ["blue",    "Who holds power, and how it passes."],
  deity:        ["amber",   "Gods, and what they are gods of."],
  creature:     ["emerald", "Beasts and other living things."],
  culture:      ["rose",    "Peoples, and how they live."],
  object:       ["zinc",    "Things that matter."],
  concept:      ["amber",   "Ideas, rules, and forces."],
  event:        ["rose",    "Things that happened."],
  language:     ["zinc",    "Tongues, scripts, and names."],
};

/** Fallback icon names for the shipped kinds, so a caller with no registry
 *  handy still renders the right symbol. */
const DEFAULT_ICON_NAMES: Record<string, string> = {
  character: "User", relationship: "Heart", location: "MapPin", lore: "BookOpen",
  faction: "Flag", religion: "Sparkles", government: "Landmark", deity: "Sun",
  creature: "PawPrint", culture: "Drama", object: "Package",
  concept: "Lightbulb", event: "CalendarClock", language: "Languages",
};

export function iconByName(name?: string): LucideIcon {
  return (name && ICONS[name]) || CircleDashed;
}

/** "dark elf" -> "Dark Elf". Applied to derived terms only. */
function titleCase(text: string): string {
  return text.split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function threadTypeEntry(
  typeId: string,
  label?: string,
  iconName?: string,
): LexEntry {
  // Title-cased when DERIVED from the id, because a type id shown to a person
  // should read as a name. A supplied label is used exactly as given -- that is
  // the writer's own wording and not ours to adjust.
  const term = label || titleCase(typeId.replace(/_/g, " "));
  const known = TYPE_TONES[typeId];
  const Icon = iconByName(iconName ?? DEFAULT_ICON_NAMES[typeId]);

  if (!known) {
    // A kind the writer added. It still gets a name and an icon -- rendering
    // a blank because we have never heard of it would punish them for using
    // a feature we built.
    return entry(typeId, term, Icon, "zinc",
      `${term} in your world.`,
      "It holds everything you know about each one.",
      `${term} is a kind of entry you added to this world. It behaves like any other Thread: it can carry Ties, a Run, and your own notes.`);
  }
  const [tone, short] = known;
  return entry(typeId, term, Icon, tone, short,
    "It gathers what you know about each one, and what it connects to.",
    CONCEPTS.thread.whatsThis);
}

/** Look up any term by its code. Concepts and stop kinds share one namespace
 *  because the UI does not care which list a word came from. */
export function lex(code: string): LexEntry | undefined {
  return CONCEPTS[code] ?? STOP_KINDS[code]
    ?? Object.values(CONCEPTS).find(e => e.code === code)
    ?? Object.values(STOP_KINDS).find(e => e.code === code);
}

/** The shipped Thread kinds, for the map legend. */
export const BUILT_IN_TYPES = Object.keys(TYPE_TONES);

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
