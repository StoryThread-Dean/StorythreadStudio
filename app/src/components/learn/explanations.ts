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
 * `free` means no model is called: no money, no waiting on anyone else's server.
 * Most of this app is free and writers assume the opposite, which makes saying
 * so worth the space.
 *
 * `spends` has to carry a note, because "this costs tokens" is not an answer a
 * writer can decide with. Whether it is one small call or a pass over the whole
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
  cost: Cost;
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
  // ── Weaving, the walkthrough ───────────────────────────────────────────────
  "weaving.what": {
    what: "Weaving reads your book and your world, then walks you through what "
      + "does not line up yet.",
    why: "Your world grows while you write, so the two drift apart. Weaving "
      + "finds the gaps instead of leaving you to remember them.",
    needed: "optional",
    cost: FREE,
    how: [
      "Pick how much to look at, then press Start.",
      "Answer each thing it finds, or skip it.",
      "Stop whenever you like. Your answers are saved as you go.",
    ],
    endpoint: "/api/codex/scan",
  },
  "weaving.scan": {
    what: "The count of things to look at, worked out before you start.",
    why: "So the number you are shown is real. An estimate that turns out wrong "
      + "two hours in is worse than no number.",
    needed: "required",
    cost: FREE,
    endpoint: "/api/codex/scan",
  },
  "weaving.depth": {
    what: "How much of your world to go through in one sitting.",
    why: "A full pass over a finished novel can find hundreds of things. Being "
      + "able to take a narrow slice is what makes it usable at all.",
    needed: "recommended",
    cost: FREE,
    how: [
      "Full manuscript looks at everything.",
      "Quick pass shows only what is already wrong -- no world-building "
        + "questions.",
      "Either way you can stop anywhere and your answers keep.",
    ],
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
      "Not a connection: never raise this phrase again.",
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
    what: "How this entry CHANGES as the story goes on.",
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
