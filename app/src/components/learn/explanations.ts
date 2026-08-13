// components/learn/explanations.ts -- what every feature owes the writer
// =================================================================
// A PRODUCT RULE WITH A TYPE BEHIND IT.
//
// Given as standing direction alongside the continuous-flow rule:
//
//     "there needs to be a rule for adding either a 'what's this?' or 'show me
//      how to do this' popup or full instructional for the purposes of teaching,
//      learning, offering assistance, why this process is happening, is it
//      necessary and or if it cost tokens."
//
// The old `WhatsThis` component took free-form children, which meant help could
// be added while answering none of that -- and most of it did. A writer could
// read three sentences about what a thing was and still not know whether they
// had to do it, or whether pressing the button would cost them money.
//
// So the contract is the TYPE. An explanation cannot be written without saying
// why it exists, whether it is necessary, and what it spends. There is nowhere
// to put a vague answer.
//
// HOW THIS WORKS WITH THE CONTINUOUS-FLOW RULE
// -------------------------------------------
// They are two halves of one thing, and they were asked for together: "asking
// and then answering if a continuation exists and how the writer is supposed to
// do that." The flow rule makes the app ASK what is next. This makes the app
// able to ANSWER how, and why, and at what cost. A next step with no explanation
// is a demand; an explanation with no next step is a lecture.

/**
 * Whether the writer has to do this.
 *
 * Stated because "is it necessary" was asked explicitly, and because most of
 * this app is optional in a way that is not obvious. A writer who thinks every
 * stop must be answered will abandon a 340-stop walk; one who knows the walk is
 * a suggestion will use it for an hour and come back.
 */
export type Need = "required" | "recommended" | "optional";

/** How each reads on screen. Kept here so no two screens word it differently. */
export const NEED_WORDING: Record<Need, string> = {
  required: "Needed. This will not work without it.",
  recommended: "Worth doing, but you can skip it and come back.",
  optional: "Entirely optional. Nothing breaks if you never do it.",
};

/**
 * What pressing the button spends.
 *
 * NICE TO HAVE RATHER THAN OBLIGATORY, corrected after the first version made it
 * mandatory: "The cost part isn't 'required' to mention, just a nice to have. A
 * quick reminder that what this particular feature is or does either costs to do
 * or doesn't."
 *
 * So an explanation may leave it out and the panel simply says nothing about
 * money. What is NOT optional is being right when it does speak: claiming free
 * on something that calls a model spends the writer's credit while promising it
 * will not, and backend/tests/test_explain_costs.py fails the build over it.
 * Silence is fine; a wrong answer is not.
 *
 * `free` means no model is called: no money, no waiting on anyone else's server.
 * Most of this app is free and writers assume the opposite, which is why it is
 * usually worth the one line.
 *
 * `spends` carries a note, because "this costs tokens" is not an answer a writer
 * can decide with. Whether it is one small call or a pass over the whole
 * manuscript is the difference between clicking and thinking about it.
 */
export type Cost =
  | { kind: "free" }
  | { kind: "spends"; note: string };

export const FREE: Cost = { kind: "free" };

export function spends(note: string): Cost {
  return { kind: "spends", note };
}

export interface Explains {
  /** What this is. One line, plain, no jargon the app invented. */
  what: string;
  /**
   * WHY it exists, or why it is happening now.
   *
   * The field most likely to be skipped and the one most often wanted. A writer
   * who knows why a question is being asked can answer it well; one who does not
   * is guessing at what the app wants to hear.
   */
  why: string;
  needed: Need;
  /** Optional. See the note on Cost: silence is fine, a wrong answer is not. */
  cost?: Cost;
  /**
   * The steps, for "Show me how to do this".
   *
   * Optional, because some things need no instructions -- but when a screen has
   * more than one control, or an order that matters, the writer should not have
   * to infer it. Written as things to DO, in order.
   */
  how?: string[];
  /**
   * The backend route this triggers, when it triggers one.
   *
   * Declared so the cost claim is CHECKABLE rather than a promise. A Python test
   * reads this file, finds the handler, and fails the build if a route that
   * calls a model is described here as free -- the same class of mistake as a
   * frontend branching on a field the API never sent.
   */
  endpoint?: string;
}

/**
 * Every explanation in the app, by a stable key.
 *
 * One registry rather than strings scattered through components, for the reason
 * the Lexicon exists: the same thing explained in two places drifts, and the
 * version the writer happens to open is then a coin toss. A contract test walks
 * this whole map.
 */
export const EXPLAIN: Record<string, Explains> = {
  // ── The editor ────────────────────────────────────────────────────────────
  //
  // THE FIRST ENTRIES HERE THAT COST MONEY. Everything in the Weave is
  // arithmetic; these two send your writing to a model. That is exactly why the
  // cost field is not optional, and why the note has to say what a pass covers
  // rather than "this uses tokens" -- one chapter and a whole book are the same
  // sentence and very different bills.
  "advisor.what": {
    what: "Three passes over what you are writing: how it reads, how it is "
      + "built, and whether it fits the rest of your story.",
    why: "It reviews rather than rewrites. Nothing changes in your chapter "
      + "until you accept a specific suggestion, so you can run a pass, read "
      + "it, and throw all of it away.",
    needed: "optional",
    cost: spends("One AI request per pass. It reads your selection if you have "
      + "one, otherwise the whole chapter, so selecting first is much cheaper "
      + "on a long chapter."),
    how: [
      "Select a passage first if you only want that looked at.",
      "Pick a pass: Readability, Structure or Context.",
      "Use the arrow beside a pass to narrow it before running, so you are not "
        + "paying to be told about grammar when you asked about pacing.",
      "Findings appear as highlights in your text. Click one to read it.",
    ],
    endpoint: "/api/ai/editor-pass",
  },
  "advisor.scope": {
    what: "Ticking which kinds of thing a pass should look for.",
    why: "A pass told to look for everything reports everything, and a long "
      + "list of small notes buries the one that mattered. Narrowing it also "
      + "makes the answer shorter and cheaper.",
    needed: "recommended",
    cost: FREE,
    how: [
      "Untick what you are not working on right now.",
      "Your choices are remembered for next time.",
    ],
  },
  "issue.what": {
    what: "One thing the pass noticed, with the rewrite it suggests.",
    why: "The change is shown word by word against your own sentence, added in "
      + "green and removed in red, so you can see exactly what it wants to do "
      + "before agreeing to any of it.",
    needed: "optional",
    cost: FREE,
    how: [
      "Read the difference. Your words are the ones without colour.",
      "Accept puts the rewrite into your chapter. Ignore drops just this note.",
      "Nothing is saved until you save the chapter, as everywhere else.",
    ],
  },
  "issue.transform": {
    what: "Asking for a different kind of rewrite of the same passage.",
    why: "The first suggestion is one reading of what your sentence needs. "
      + "Shorter, more sensory, or a change of tone are different jobs, and "
      + "asking for one is faster than arguing with the first answer.",
    needed: "optional",
    cost: spends("One AI request each time you press one of these, over just "
      + "this passage. Small, but it is per press, so it adds up if you cycle "
      + "through them."),
    how: [
      "Press a kind of rewrite: Shorten, Expand, Describe, and so on.",
      "Default puts the original suggestion back, and costs nothing.",
      "Accept when one of them is right.",
    ],
    endpoint: "/api/ai/revise-suggestion",
  },
  "thesaurus.what": {
    what: "Right-click a word for spellings and alternatives.",
    why: "The editor's red underline comes from the operating system, which "
      + "will not hand its corrections to the app. So corrections are worked "
      + "out here instead, and put above the synonyms, because fixing a typo "
      + "is why most people right-click a word.",
    needed: "optional",
    cost: FREE,
    how: [
      "Right-click any word in your chapter.",
      "Click a suggestion to swap it in. Your capitalisation is kept.",
      "Press Escape to leave the word alone.",
    ],
  },

  // ── Profiles ──────────────────────────────────────────────────────────────
  //
  // All free, and worth SAYING so. These read like AI features and are not: the
  // text comes from lists that ship with the app, and a writer who assumes
  // otherwise avoids the cheapest tools in here.
  "quickbuild.what": {
    what: "Rolling options for a side character and clicking the ones that fit.",
    why: "Most characters in a book need a couple of lines, not a full profile. "
      + "This is for filling those in quickly without inventing a personality "
      + "from nothing at nine in the evening.",
    needed: "optional",
    cost: FREE,
    how: [
      "Pick the part they play in the story.",
      "Click any option to add it to that section as a new line.",
      "Roll again for a different set. It works through the whole list before "
        + "repeating anything.",
      "Everything it adds is ordinary text you can edit or delete.",
    ],
  },
  "quickbuild.adult": {
    what: "Turning on adult options for this character.",
    why: "It REPLACES the ordinary options rather than adding to them, so the "
      + "list stays the same length. Explicit then replaces those again with a "
      + "spicier set, mostly written as blanks for you to fill in so the app is "
      + "suggesting rather than deciding.",
    needed: "optional",
    cost: FREE,
    how: [
      "Turn it on per character. It is never on by default and never turned on "
        + "for you by a genre setting.",
      "Explicit only becomes available once it is on.",
      "Turn it off to get the ordinary options back.",
    ],
  },
  "spine.what": {
    what: "Two cheat sheets: a personality pattern and a story role.",
    why: "A starting point rather than a label. Both insert a few sentences of "
      + "ordinary text into the profile, written to be argued with -- the point "
      + "is to have something on the page to react to.",
    needed: "optional",
    cost: FREE,
    how: [
      "Pick one. The text goes into the profile straight away.",
      "The dropdown clears itself afterwards, because it is not a field being "
        + "set -- nothing remembers which one you chose.",
      "Picking a story role also fills in the Role field and adds a few tags.",
      "Edit or delete what it inserted like any other text.",
    ],
  },
  "names.what": {
    what: "Rolling given names and surnames, by culture and era or by fantasy "
      + "race.",
    why: "Naming a character you invented thirty seconds ago is the thing most "
      + "likely to stop you writing. Real-world names come from lists that "
      + "ship with the app; fantasy ones are assembled from sounds, so there "
      + "are more of them than any list could hold.",
    needed: "optional",
    cost: FREE,
    how: [
      "Choose a culture and era, or a fantasy race.",
      "Click a first name, a surname, or just one of the two. Either alone is "
        + "a real answer.",
      "Deal again for six more. It works through the pool before repeating.",
      "Use this name puts whatever you picked into the Name field.",
    ],
    endpoint: "/api/names/pool",
  },

  // ── Weaving, the walkthrough ───────────────────────────────────────────────
  "weaving.what": {
    what: "Weaving: four passes over your book and your world, each asking a "
      + "different question.",
    why: "Your world grows while you write, so the two drift apart. The passes "
      + "are separate because tidying up, writing a chapter, checking for "
      + "contradictions and inventing how a world works are different jobs, and "
      + "mixing them buries whichever one you came to do.",
    needed: "optional",
    cost: FREE,
    how: [
      "Dress the Loom first: what is here, and what relates to what. Start "
        + "there, and come back to it whenever your world grows.",
      "Weave the Chapters as you write: pairs your scenes keep putting "
        + "together that nothing records a connection between yet.",
      "Read the Cloth when you step back, to see where the book contradicts "
        + "itself.",
      "Unwoven is its own job, any time: the ground rules of your world.",
      "Answer each thing a pass finds, or skip it. Skipping is a real answer, "
        + "and your answers save as you go.",
    ],
    endpoint: "/api/codex/scan",
  },
  "export.weave": {
    what: "Your world model, out of the app, in three shapes at once.",
    why: "Your chapters and entries are Markdown files, so they already travel "
      + "-- copy the folder and they come with you. What the Weave ADDS does "
      + "not: the connections between things, the reasons you gave them, and "
      + "what is true at which point in the book. This writes all of that to "
      + "exports/ as a document you can read, a JSON file a program can read, "
      + "and CSV tables a spreadsheet can open. Chapters appear by name as well "
      + "as by id, so the files still make sense outside this app.",
    needed: "optional",
    cost: FREE,
    how: [
      "Press Export the Weave. It writes a dated folder into exports/.",
      "Open weave.md for the readable one: every entry, its connections with "
        + "the reason you wrote, and what changes through the story by chapter "
        + "name.",
      "Keep weave.json if you want the whole graph with ids intact, for "
        + "anything you or somebody else builds later.",
      "Open the three CSVs in a spreadsheet: entries, connections and facts, "
        + "one table each, because a spreadsheet cannot open a nested file.",
      "Ticking The Weave on a manuscript export instead puts the readable "
        + "version at the end of your book.",
    ],
    endpoint: "/api/export/weave",
  },
  "profile.page": {
    what: "The page where you build one thing in your world: a person, a place, "
      + "a faction, a faith.",
    why: "It is ordered the way you would explain somebody to a friend, and you "
      + "can stop at any point. Basics, then what changes about them through the "
      + "story, then who they are to other people, then a few sentences on who "
      + "they are, then the detail. Trunk, branches, leaves. A name and one line "
      + "is already a real entry -- the app will use it, and nothing here nags "
      + "you for the rest.",
    needed: "recommended",
    cost: FREE,
    how: [
      "Fill in the name and what they are to the story. That is enough to save.",
      "Add anything that becomes true at a POINT in the book under How this "
        + "changes -- that is the part no other screen can do.",
      "Connections are chips until you open them, and Weaving offers most of "
        + "them from your manuscript rather than making you type them.",
      "The Overview is two or three sentences. It is the one section the app "
        + "checks for, and an empty one is what the Weave calls Frayed.",
      "Traits are tiles: closed until you want them, and they stay open while "
        + "you work. Use Show me how this works for the whole page in order.",
    ],
  },
  "character.subtext": {
    what: "A trait AI uses and never says out loud.",
    why: "Because the reason a character behaves as they do is often the thing "
      + "they would never explain, and it is usually the most important thing "
      + "about them. A villain avoids hospitals because he watched his parents "
      + "die in one; the reader should feel him avoid them, not be told why. "
      + "Turning this on sends the trait to AI at its full weight and forbids "
      + "AI from naming, quoting or hinting at it in prose. It shows only as "
      + "behaviour: a hesitation, a look away, something the character will not "
      + "do. This is a SEPARATE question from importance, which is only about "
      + "how much a trait shapes them. Something can be the single most "
      + "load-bearing fact about a person and the thing they would never say.",
    needed: "optional",
    cost: FREE,
    how: [
      "Set the importance as you would for any trait. Secrecy does not make it "
        + "less important, and Core is the ordinary setting for a secret that "
        + "drives a character.",
      "Turn on the eye control beside it. The trait now reaches AI with an "
        + "instruction never to state it.",
      "Feedback is different from prose: Smart Advisor MAY name a secret when "
        + "talking to you, because you wrote it. Any prose it suggests still has "
        + "to express it as behaviour.",
      "Use Show me how this works for one secret walked through three weights, "
        + "and what each produces in Draft, Enhance and a context check.",
      "For something the reader learns LATER rather than never, use a fact on "
        + "the entry's Run with the chapter attached instead.",
    ],
  },
  "character.template": {
    what: "Whether this character gets the full page or the simple one.",
    why: "Most people in a book are not viewpoint characters. A Main character "
      + "page gives you six trait sections with an importance level on every "
      + "trait, which is what you want for someone the story follows and far "
      + "more than you want for the innkeeper in chapter four. A Side page is "
      + "one plain box per section, and Quick Build fills it in a few clicks. "
      + "You are not stuck with the choice -- this is the button that changes "
      + "it, in either direction, whenever the character turns out to matter "
      + "more or less than you thought.",
    needed: "optional",
    cost: FREE,
    how: [
      "Make Side turns every trait you have written into a line of text in the "
        + "same section. Nothing is deleted.",
      "A trait marked Hidden is the one thing that changes meaning: a Side "
        + "character has no Hidden level, so the line starts with \"Hidden:\" "
        + "and AI can use it like anything else you wrote. The screen says how "
        + "many before you decide.",
      "Make Main adds an empty trait list to each section and leaves your text "
        + "exactly where it is. Move lines into traits whenever you like.",
      "Nothing is saved until you save, so you can convert, look at the result, "
        + "and switch profiles to undo it.",
    ],
  },
  "profile.home": {
    what: "Which folder this screen is reading your entries from.",
    why: "Your world lives in one of two places. Before you bring it into the "
      + "Weave it sits in your profiles folder, exactly where it always has. "
      + "After you bring it in, the Weave's own folder is the live one and the "
      + "profiles folder is left behind as a copy. This screen follows the live "
      + "one, and the sidebar counts the same folder, so the two can never "
      + "disagree about how many characters you have.",
    needed: "optional",
    cost: FREE,
    how: [
      "Nothing to do. This is here to explain a count, not to be set.",
      "If it says entries were made in the Weave and are not shown here, they "
        + "are in the Weave's folder while your profiles are still in the old "
        + "one. Bring your world in from the Weave and everything appears on "
        + "this screen together.",
      "Until you do, those entries are still editable -- open them from the "
        + "Weave map instead.",
    ],
    endpoint: "/api/codex/health",
  },
  "profile.connections": {
    what: "Who this is to everything else in your world, and why.",
    why: "A profile says what someone IS. This says what they are TO people -- "
      + "which is most of what a scene runs on, and the part the AI is told "
      + "when you ask for help. The short line you write against a connection "
      + "('takes care of her needs when the curse flares up') is worth more "
      + "than the label on it.",
    needed: "recommended",
    cost: FREE,
    how: [
      "Connect this to something opens the same connect screen the Weave "
        + "uses: pick the other end, say why in one line, and label it if you "
        + "want to.",
      "Chips are the quick read. Expand for what each connection actually is.",
      "A connection is stored once and read from both ends, so one made here "
        + "shows on the other one's page too -- the expanded list says which "
        + "page it is recorded on.",
    ],
    endpoint: "/api/codex/ties",
  },
  "thread.fix-or-remove": {
    what: "Change what kind of thing an entry is, or remove it entirely.",
    why: "Weaving offers Character for a name it finds in your prose, because "
      + "most names in prose are people -- so a god, a ship or a house gets "
      + "filed as a person the first time it is mentioned. Changing the kind "
      + "keeps everything you wrote; before this, the only fix was to delete "
      + "the entry and start again.",
    needed: "optional",
    cost: FREE,
    how: [
      "Pick the right kind and Change it. The name, the writing and every "
        + "connection stay as they are.",
      "A connection that no longer makes sense between those kinds is "
        + "pointed out and kept -- correcting a mistake should not quietly "
        + "delete your work.",
      "Remove this entry deletes it and everything in it. Your manuscript is "
        + "never touched.",
      "Because the prose still says the name, removing an entry lets Weaving "
        + "ask about it again rather than staying quiet about it forever.",
    ],
    endpoint: "/api/codex/entity/kind",
  },
  "weave.context": {
    what: "The part of your world the AI is told about, before you ask it "
      + "anything.",
    why: "So you do not have to paste a character profile into the chat to be "
      + "understood. The Weave picks out what your writing names and what "
      + "connects to it, AS OF where you are in the book -- so the AI knows "
      + "what your story knows so far, and not what happens later. You can "
      + "read every word of it, drop anything from it, or switch it off.",
    needed: "optional",
    cost: FREE,
    how: [
      "Inspect shows each Thread, why it is there, and roughly what it costs.",
      "The x beside a Thread drops it. Removed Threads are listed underneath "
        + "so you can put one back.",
      "The kind buttons leave out a whole category at a time.",
      "Read it exactly as the AI will shows the actual words.",
      "Turn world context off sends only what you attach by hand.",
    ],
    endpoint: "/api/codex/context",
  },
  "weaving.scan": {
    what: "The count of things to look at, worked out before you start.",
    why: "So the number you are shown is real. An estimate that turns out wrong "
      + "two hours in is worse than no number.",
    needed: "required",
    cost: FREE,
    endpoint: "/api/codex/scan",
  },
  "weaving.quick-entry": {
    what: "A base-level entry: a name, its kind, and one line to build on.",
    why: "The Weave builds the framework so the walkthrough can keep moving -- "
      + "you never leave it to go create something elsewhere. Expanding the "
      + "entry into a full profile is your later work, from the sidebar, "
      + "whenever you like.",
    needed: "optional",
    cost: FREE,
    how: [
      "Check the name, and the kind if it guessed wrong.",
      "The text box is a starting line, not a commitment. Where it is "
        + "prefilled, that is your own sentence from the manuscript.",
      "Create it, then connect it to something or move straight on.",
    ],
    endpoint: "/api/codex/thread/new",
  },
  "weaving.fill": {
    what: "The entry's empty sections, right here, as text boxes.",
    why: "A Frayed entry has writing but is missing the parts its kind says "
      + "are worth having. Filling them here keeps the walkthrough moving -- "
      + "the full editor is still there for real writing sessions later.",
    needed: "optional",
    cost: FREE,
    how: [
      "Write into whichever boxes you have something for. Empty boxes change "
        + "nothing.",
      "Press Save. If the entry was edited somewhere else meanwhile, the save "
        + "is refused and your text stays in the boxes.",
    ],
    endpoint: "/api/codex/entity",
  },
  "weaving.snag-fixer": {
    what: "The two sides of a Snag, with ways to settle it in place.",
    why: "Two recorded facts clash, or a fact has no point in the story, or "
      + "the prose names something before your world says it exists. All of "
      + "these are settled here, without opening anything.",
    needed: "optional",
    cost: FREE,
    how: [
      "Keep the right side, or fix one where it stands -- its text or its "
        + "chapter.",
      "Or say both are right ON PURPOSE. Much good fiction contradicts itself "
        + "deliberately, and marking it so means this is never asked again.",
      "Not sure yet? Back out -- Not yet keeps it for next time.",
    ],
    endpoint: "/api/codex/fact",
  },
  "weaving.why-seeing": {
    what: "The rule that put this in front of you, and the text that set it off.",
    why: "A walkthrough that cannot explain itself teaches you to click through "
      + "it. If a suggestion is wrong you should be able to see why straight "
      + "away.",
    needed: "optional",
    cost: FREE,
  },
  "weaving.triage": {
    what: "Four ways to answer, and they mean different things.",
    why: "Because 'no' has more than one meaning. Some things are wrong "
      + "forever, some are not wrong yet, and some you never want asked again.",
    needed: "required",
    cost: FREE,
    how: [
      "Answer it to record what you decided.",
      "The permanent no is worded for the kind of stop it is on -- 'Never "
        + "make this an entry', 'Not a problem', 'Leave it as it is' -- and "
        + "it is never raised again.",
      "Not yet: it comes back next time.",
      "Never ask: mute this whole kind of question.",
    ],
  },

  // ── Connections ───────────────────────────────────────────────────────────
  "tie.reason": {
    what: "One line, in your words, saying why these two are connected.",
    why: "This is what gets sent to AI when you ask for help with a scene. "
      + "'Connected to' tells a model nothing your prose did not already show; "
      + "'is hiding her theft from him' is the whole scene.",
    needed: "required",
    cost: FREE,
    how: [
      "Say what one is to the other, in a sentence.",
      "Keep it to a line. It is sent with every request, so a long one gets "
        + "left out to make room.",
      "Add the other side too if it reads differently from there.",
    ],
    endpoint: "/api/codex/tie",
  },
  "tie.relation": {
    what: "A label for the connection, chosen from a grouped list.",
    why: "The label is what makes connections searchable and drawable on the "
      + "map. It is the tidy half, not the useful half, which is why you can "
      + "skip it.",
    needed: "optional",
    cost: FREE,
    how: [
      "Leave it on 'choose from ...' to record a plain connection.",
      "Or pick one under a heading -- only connections that mean something "
        + "between these two kinds are listed.",
      "Write my own adds a label your world does not have yet.",
    ],
    endpoint: "/api/codex/relations",
  },
  "tie.own-label": {
    what: "Naming a connection this app does not ship.",
    why: "No shipped vocabulary covers an invented world. The label becomes "
      + "part of what is sent to AI, so plain words a model knows land better "
      + "than invented ones -- though the reason line can carry the meaning if "
      + "your world needs a word nobody knows.",
    needed: "optional",
    cost: FREE,
    how: [
      "Type it the way you would say it: 'blood-sworn to'.",
      "Give the other half too if it is not just the same phrase backwards.",
      "It joins your world, so you can use it again.",
    ],
    endpoint: "/api/codex/relation",
  },
  "tie.when": {
    what: "The point in the story a connection became true.",
    why: "A relationship is not fixed. Acquaintances in chapter two and friends "
      + "in chapter four is one connection that CHANGED, and dating it is what "
      + "lets the app tell AI which is true where you are writing.",
    needed: "optional",
    cost: FREE,
    how: [
      "Leave it unset for something that is simply true of the whole book.",
      "Set it to record when it changed. A later state replaces an earlier one "
        + "on its own -- you never close the old one.",
    ],
  },

  // ── Entries ───────────────────────────────────────────────────────────────
  "thread.placeholder": {
    what: "An entry made from a name in your writing, with nothing in it yet.",
    why: "So the walk can carry on. Making you write a full profile before you "
      + "can record a connection stops the thing you came to do.",
    needed: "optional",
    cost: FREE,
    how: [
      "Connect it now if you know what it relates to.",
      "Fill it in later, from the sidebar or the map.",
    ],
  },
  "thread.absorb": {
    what: "Telling the app that a word in your prose means an entry you already "
      + "have.",
    why: "Your writing calls the same person several things. Without this, every "
      + "spelling looks like a different character and the map fills with "
      + "duplicates.",
    needed: "recommended",
    cost: FREE,
    how: [
      "Pick the entry the word means.",
      "Or say it is its own thing, and give it an entry.",
      "Nothing in your manuscript is changed either way.",
    ],
    endpoint: "/api/codex/absorb",
  },

  // ── Writing an entry ──────────────────────────────────────────────────────
  "thread.editor": {
    what: "The page for one thing in your world: a faction, a god, a place.",
    why: "Characters have their own builder. Everything else lives here, and "
      + "the sections you get come from what KIND of thing it is, so a religion "
      + "is not asked for a date of birth.",
    needed: "recommended",
    cost: FREE,
    how: [
      "Write in whichever sections you have something for. Blanks are fine.",
      "Press Save. There is no autosave anywhere in this app, so unsaved work "
        + "looks unsaved.",
      "Use Run to record how this changes across the story.",
    ],
    endpoint: "/api/codex/entity",
  },
  "thread.run": {
    what: "The Run: how this entry CHANGES as the story goes on.",
    why: "A profile describes one unchanging thing, which is wrong. A heroine "
      + "who believes her father died for fourteen chapters is a different "
      + "person afterwards, and AI should be told whichever is true where you "
      + "are writing.",
    needed: "optional",
    cost: FREE,
    how: [
      "Add what became true, and the chapter it became true in.",
      "A later one replaces an earlier one on the same subject by itself.",
      "Say whose truth it is if only one character believes it.",
    ],
    endpoint: "/api/codex/fact",
  },

  // ── Converting an older project ───────────────────────────────────────────
  "migrate.what": {
    what: "Converting your existing profiles folder into the Weave.",
    why: "The Weave keeps things the old profiles could not: who relates to "
      + "whom, when something became true, and what the reader does not know "
      + "yet. Your writing is untouched either way.",
    needed: "required",
    cost: FREE,
    how: [
      "Run the preview first. It changes nothing and lists every file it "
        + "would convert.",
      "Read the plan, including anything it says it cannot convert.",
      "Your profiles folder is copied to a dated backup before anything is "
        + "written, and that copy is never deleted for you.",
      "Then run it for real, and read the report afterwards.",
    ],
    endpoint: "/api/codex/migrate",
  },

  // ── The map ───────────────────────────────────────────────────────────────
  "map.scrubber": {
    what: "The story timeline. Drag it to see your world as it stood at any "
      + "chapter.",
    why: "Because a world is not one snapshot. Reading chapter seven should "
      + "show what was true then, not what you know now.",
    needed: "optional",
    cost: FREE,
    how: [
      "Drag the handle, or use the arrow keys.",
      "Entries and connections appear as the story introduces them.",
      "Turn on spoilers-hidden to see only what a reader would know.",
    ],
    endpoint: "/api/codex/graph",
  },
  "map.spoilers": {
    what: "Hides anything the reader has not learned yet at this point.",
    why: "So you can check what a chapter gives away. It hides secret "
      + "connections too, not just secret facts -- a labelled line between two "
      + "people is a reveal on its own.",
    needed: "optional",
    cost: FREE,
  },
};

/** Every key, for contract tests and for finding an explanation by name. */
export const EXPLAIN_KEYS = Object.keys(EXPLAIN);

export function explain(key: string): Explains | undefined {
  return EXPLAIN[key];
}
