// data/characterSpines.ts -- Canned personality-spine content
// =============================================================
// The "spine" of a character = WHO they are inside (Enneagram) + WHAT role they
// play in the story. Writer-initiated, hand-editable, zero AI calls: every
// word here is static text shipped with the app.
//
// REDESIGNED 2026-08-25, spec at docs/character-spine-spec.md. The Enneagram
// is a STORED FIELD whose sentences are taken a facet at a time, and Story
// Role is one appending control beside the Role field. It used to be two
// dropdowns that each dropped a whole paragraph in and overwrote Role.
//
// House style for every summary ("fiction-first", never the flattering
// personality-quiz register): behavior + speech pattern + how they crack
// under pressure, ending with a fill-in hook so the writer personalizes it.
// The formula everywhere: trait + trigger + origin.
//
// Naming note: deliberately Enneagram + Jungian archetypes. Do NOT add
// "Myers-Briggs"/"MBTI" naming anywhere -- trademarked. A 16-type list, if
// ever added, gets a generic label ("Personality Type (16-type)").

/**
 * The part of a personality a writer takes or leaves on its own.
 *
 * WHY THIS EXISTS, in the writer's own report: picking type 1 for a merchant
 * who only ever appears in her own shop inserted one paragraph, of which
 * "wants to be good and beyond reproach" was useful and "notices the crooked
 * picture frame in any room" was not. Both judgements were right and there was
 * no way to act on either, because the summary was a single string.
 *
 * The content was never the problem. The GRANULARITY was. See
 * docs/character-spine-spec.md section 1.1.
 */
export type FacetKind =
  | "wants"     // the core desire
  | "dreads"    // the core fear
  | "habit"     // one concrete behaviour, on its own line
  | "speech"    // how they talk
  | "cracks"    // what stress does to them: the arc fuel
  | "hook";     // a ____ blank for the writer to fill in

export interface SpineFacet {
  /** Stable, derived from the option id. Tests cite it; greying keys on it. */
  id: string;
  kind: FacetKind;
  /** ONE sentence. Must read correctly with nothing above it. */
  text: string;
}

export interface SpineOption {
  id: string;      // stable key
  label: string;   // dropdown display
  help: string;    // one-line "What's this?" definition
  summary: string; // every facet joined -- what "Everything" inserts
  /**
   * Present on the Enneagram, absent on archetypes.
   *
   * Archetype guidance is two or three sentences, so there is little to trim
   * and no pick-and-choose screen for it (spec section 8). The type allows for
   * one later without a second shape.
   */
  facets?: SpineFacet[];
}

/**
 * Build one option, deriving the summary from the facets.
 *
 * The summary is DERIVED rather than authored beside them, so the paragraph and
 * the pieces cannot disagree. Authoring both was how a paragraph came to exist
 * that nothing could take apart.
 *
 * Facet ids come from the option id plus the kind and its position, so they are
 * stable while the order is, and nobody has to hand-number thirty of them.
 */
function spine(id: string, label: string, help: string,
               lines: [FacetKind, string][]): SpineOption {
  const seen: Partial<Record<FacetKind, number>> = {};
  const facets = lines.map(([kind, text]) => {
    const n = (seen[kind] = (seen[kind] ?? 0) + 1);
    return { id: `${id}-${kind}${n}`, kind, text };
  });
  return { id, label, help, facets,
           summary: facets.map(f => f.text).join(" ") };
}

/** The facets "Essentials" ticks: who they are and how they sound. */
export const ESSENTIAL_KINDS: FacetKind[] = ["wants", "dreads", "speech"];

/** Heading for each group in the picker, so eight lines read as a shape. */
export const FACET_KIND_LABELS: Record<FacetKind, string> = {
  wants:  "What they want",
  dreads: "What they dread",
  habit:  "How they behave",
  speech: "How they talk",
  cracks: "Under pressure",
  hook:   "For you to fill in",
};

// ── Enneagram -- the inner engine ────────────────────────────────────────────
// Each summary carries the type's core desire, core fear, and stress
// behavior, because that trio is motivation + arc fuel in one package.

export const ENNEAGRAM_OPTIONS: SpineOption[] = [
  spine("e1", "1 -- The Reformer",
        "Principled and self-controlled; driven to be right and good.", [
    ["wants",  "Wants to be good and beyond reproach."],
    ["dreads", "Dreads being corrupt or wrong."],
    ["habit",  "Holds themselves and everyone nearby to a standard no one "
               + "agreed to."],
    ["habit",  "Notices the crooked picture frame in any room."],
    ["habit",  "Apologizes rarely but corrects often."],
    ["speech", "Speech is precise, measured, lightly instructional."],
    ["cracks", "Under pressure the inner critic turns outward: nitpicking "
               + "becomes resentment, resentment becomes cold fury at a world "
               + "that will not behave."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e2", "2 -- The Helper",
        "Warm and generous; needs to be needed.", [
    ["wants",  "Wants to be loved and indispensable."],
    ["dreads", "Dreads being unwanted."],
    ["habit",  "Remembers everyone's birthday."],
    ["habit",  "Shows up with soup before being asked."],
    ["habit",  "Keeps a silent ledger of favors no one else knows they owe."],
    ["speech", "Speech is warm, attentive, full of questions about you and "
               + "deflections about them."],
    ["cracks", "Under pressure the giving turns pointed: reminders of all they "
               + "have done, guilt served with a smile, love wielded as "
               + "leverage."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e3", "3 -- The Achiever",
        "Adaptable and driven; success is identity.", [
    ["wants",  "Wants to be admired as a success."],
    ["dreads", "Dreads being worthless without the trophies."],
    ["habit",  "Reads every room and becomes whatever wins it."],
    ["habit",  "Works while others sleep."],
    ["habit",  "Treats feelings as scheduling conflicts."],
    ["speech", "Speech is confident, polished, quietly always presenting."],
    ["cracks", "Under pressure the mask cracks in private only: cutting "
               + "corners, inflating wins, and raging at anyone who saw them "
               + "fail."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e4", "4 -- The Individualist",
        "Expressive and deep; longs to be uniquely understood.", [
    ["wants",  "Wants an identity all their own."],
    ["dreads", "Dreads being ordinary and overlooked."],
    ["habit",  "Feels everything a size larger than everyone else."],
    ["habit",  "Curates their surroundings like a self-portrait."],
    ["habit",  "Half-treasures the melancholy they complain about."],
    ["speech", "Speech is vivid, personal, allergic to cliche."],
    ["cracks", "Under pressure they withdraw into envy and dramatics, certain "
               + "no one has ever felt this and no one ever could."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e5", "5 -- The Investigator",
        "Private and cerebral; hoards knowledge, energy, and space.", [
    ["wants",  "Wants to be competent and self-sufficient."],
    ["dreads", "Dreads being drained or invaded."],
    ["habit",  "Watches from the edge of the room."],
    ["habit",  "Knows more than they say by a wide margin."],
    ["habit",  "Rations time with people like a scarce supply."],
    ["speech", "Speech is spare, exact, delivered after a pause that means "
               + "thinking."],
    ["cracks", "Under pressure they detach completely, hoarding information "
               + "and vanishing into work or theory while the house burns."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e6", "6 -- The Loyalist",
        "Committed and vigilant; scans for what could go wrong.", [
    ["wants",  "Wants security and someone worth trusting."],
    ["dreads", "Dreads being abandoned without support."],
    ["habit",  "Sees the exits in every room."],
    ["habit",  "Stress-tests people before relying on them."],
    ["habit",  "Is the steadiest hand in a real crisis, because they "
               + "rehearsed it a hundred times."],
    ["speech", "Speech runs to questions, caveats, devil's-advocacy."],
    ["cracks", "Under pressure they either cling to authority or lash out at "
               + "it, sometimes both in an hour."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e7", "7 -- The Enthusiast",
        "Spontaneous and upbeat; runs from pain toward the next thing.", [
    ["wants",  "Wants to be delighted and free."],
    ["dreads", "Dreads being trapped in pain or boredom."],
    ["habit",  "Plans three adventures while finishing none."],
    ["habit",  "Retells disasters as comedies within the week."],
    ["habit",  "Keeps every option open, including the ones that hurt "
               + "people."],
    ["speech", "Speech is quick, funny, topic-hopping."],
    ["cracks", "Under pressure the escape hatch becomes the whole "
               + "personality: excess, recklessness, and a smile stretched "
               + "over panic."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e8", "8 -- The Challenger",
        "Forceful and protective; control beats vulnerability.", [
    ["wants",  "Wants to be in control of their own fate."],
    ["dreads", "Dreads being weak or at someone's mercy."],
    ["habit",  "Fills doorways even when small."],
    ["habit",  "Tests strangers with bluntness to see who flinches."],
    ["habit",  "Guards their few chosen people like territory."],
    ["speech", "Speech is direct, loud-carrying, comfortable with "
               + "confrontation others tiptoe around."],
    ["cracks", "Under pressure force is the answer to everything: "
               + "intimidation, ultimatums, scorched earth before surrender."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
  spine("e9", "9 -- The Peacemaker",
        "Easygoing and steady; merges with others to keep the peace.", [
    ["wants",  "Wants inner peace and no conflict."],
    ["dreads", "Dreads mattering so little that asserting themselves ends in "
               + "loss."],
    ["habit",  "Agrees to plans they hate."],
    ["habit",  "Sees every side until they cannot find their own."],
    ["habit",  "Absorbs the moods of whoever is loudest."],
    ["speech", "Speech is mild, meandering, quick to soothe."],
    ["cracks", "Under pressure they do not explode, they fog out: "
               + "procrastinating, going stubbornly passive, gone from the "
               + "room while still sitting in it."],
    ["hook",   "This sharpens around ____ because ____."],
  ]),
];

// ── Story role -- the 12 Jungian archetypes + story-role extras ──────────────
// Archetype answers "what does this character DO in the story"; the
// Enneagram answers "how do they behave doing it". They stack: a Caregiver
// driven by Enneagram 8 reads nothing like a Caregiver driven by 2.

export const ARCHETYPE_OPTIONS: SpineOption[] = [
  {
    id: "hero",
    label: "Hero",
    help: "Proves worth through courage; carries the main struggle.",
    summary:
      "Story role: the one who must act when acting costs the most. Their "
      + "courage is less the absence of fear than a refusal to hand the "
      + "problem to someone else, and the story keeps raising the price of "
      + "that refusal. Weakness to write toward: pride in being the one who "
      + "acts -- they volunteer for burdens that were never theirs to carry.",
  },
  {
    id: "mentor",
    label: "Mentor / Sage",
    help: "Wisdom-giver; arms the hero with truth or tools.",
    summary:
      "Story role: the keeper of hard-won knowledge who can advise but not "
      + "act -- their fight is already behind them, and it left marks. They "
      + "teach in questions or parables and withhold the one truth the hero "
      + "is not ready for. Weakness to write toward: their wisdom has a blind "
      + "spot shaped exactly like their own old failure.",
  },
  {
    id: "caregiver",
    label: "Caregiver",
    help: "Protects and nurtures; serves others before self.",
    summary:
      "Story role: the one who holds everyone else together. They feed "
      + "people, patch wounds, keep the lights on, and are always the last "
      + "to be asked how they are doing. Weakness to write toward: martyrdom "
      + "-- they will burn themselves down to warm the room and resent that "
      + "no one stopped them.",
  },
  {
    id: "explorer",
    label: "Explorer",
    help: "Restless seeker; freedom over belonging.",
    summary:
      "Story role: the one who cannot stay. They map the edges of every "
      + "situation, leave before being left, and bring back what no one else "
      + "would have found. Weakness to write toward: the wandering is also "
      + "running -- every departure has the same face in the rearview mirror.",
  },
  {
    id: "rebel",
    label: "Rebel / Outlaw",
    help: "Breaks what deserves breaking; revolution as identity.",
    summary:
      "Story role: the one who says out loud that the system is rotten and "
      + "acts on it. Magnetic to the frustrated, dangerous to befriend, "
      + "allergic to being managed. Weakness to write toward: they know "
      + "exactly what to destroy and nothing about what to build after.",
  },
  {
    id: "lover",
    label: "Lover",
    help: "Devotion and passion; connection is the point of everything.",
    summary:
      "Story role: the one who makes the stakes personal. They love -- a "
      + "person, a place, a craft -- with an intensity that makes them both "
      + "the warmest presence in the story and the easiest to wound. Weakness "
      + "to write toward: they will trade anything, including themselves and "
      + "the truth, to keep the beloved close.",
  },
  {
    id: "creator",
    label: "Creator",
    help: "Builds the new thing; imagination with a deadline problem.",
    summary:
      "Story role: the maker -- of machines, of plans, of art, of the thing "
      + "the plot needs that does not exist yet. Sees the finished work "
      + "before anyone else can and suffers every gap between vision and "
      + "result. Weakness to write toward: perfectionism that ships nothing, "
      + "and the temptation to treat people as materials.",
  },
  {
    id: "jester",
    label: "Jester",
    help: "Levity with license; the only one allowed to tell the truth.",
    summary:
      "Story role: the pressure valve. Their timing is a weapon, their jokes "
      + "land where sermons would bounce, and because no one takes them "
      + "seriously they can say what no one else dares. Weakness to write "
      + "toward: the comedy is load-bearing -- take away the audience and "
      + "find out what the jokes were holding down.",
  },
  {
    id: "innocent",
    label: "Innocent",
    help: "Uncorrupted sincerity; faith the story will test.",
    summary:
      "Story role: the character the world has not gotten to yet. Their "
      + "trust makes hardened characters protective and cynical ones "
      + "uncomfortable, and the story will make that trust expensive. "
      + "Weakness to write toward: innocence can curdle -- betray it badly "
      + "enough and it returns as something much colder.",
  },
  {
    id: "everyman",
    label: "Everyman",
    help: "The relatable center; belongs to no faction but the reader's.",
    summary:
      "Story role: the reader's feet on the ground. Competent at ordinary "
      + "things, out of their depth in extraordinary ones, and honest about "
      + "the difference. Weakness to write toward: the wish to stay unnoticed "
      + "-- they will let worse people lead rather than step forward.",
  },
  {
    id: "ruler",
    label: "Ruler",
    help: "Order through control; the crown is heavy and gripped tight.",
    summary:
      "Story role: the one responsible for everyone, and never allowed to "
      + "show the weight. They think in consequences and successions, reward "
      + "loyalty, and remember disloyalty forever. Weakness to write toward: "
      + "control mistaken for safety -- they would rather rule a shrinking "
      + "kingdom than trust a growing one.",
  },
  {
    id: "shadow",
    label: "Shadow / Villain",
    help: "The dark mirror; wants something real by unacceptable means.",
    summary:
      "Story role: the argument the hero cannot ignore. A shadow works "
      + "because they are right about at least one thing, and because their "
      + "method is the hero's own temptation taken seriously. Weakness to "
      + "write toward: the wound that made the method feel necessary -- the "
      + "reader should be able to trace it even if they never forgive it.",
  },
  // -- Story-role extras (not Jungian, but constantly needed) --
  {
    id: "comic_relief",
    label: "Comic Relief",
    help: "Perfect timing; funnier the darker the story gets.",
    summary:
      "Story role: the pressure gauge disguised as a punchline. Their quips "
      + "arrive exactly when the tension peaks, and the reader only realizes "
      + "later that the jokes were doing emotional work the story could not "
      + "say straight. Weakness to write toward: humor as armor -- the one "
      + "scene where the joke does not come is the loudest scene they have.",
  },
  {
    id: "confidant",
    label: "Confidant",
    help: "The safe pair of ears; hears what the reader needs to know.",
    summary:
      "Story role: the one the protagonist can be honest with, which makes "
      + "them the reader's window into what the hero will not admit "
      + "elsewhere. Steady, discreet, often underestimated by everyone but "
      + "the audience. Weakness to write toward: carrying secrets has a "
      + "cost, and they know at least one they should never have been told.",
  },
  {
    id: "rival",
    label: "Rival",
    help: "Not a villain -- a competitor who keeps the hero honest.",
    summary:
      "Story role: the measuring stick. They want the same prize by "
      + "legitimate means, expose the hero's shortcuts by simply existing, "
      + "and are one earned handshake away from being an ally. Weakness to "
      + "write toward: the rivalry matters more to them than the prize -- "
      + "winning against nobody would taste like nothing.",
  },
];

export function spineOptionById(options: SpineOption[], id: string): SpineOption | undefined {
  return options.find(o => o.id === id);
}

/**
 * Match a profile's free-text Role field back to an archetype id, so the
 * Quick Build Story Role select can default to what the writer already
 * chose (its own selection is session-only and resets when the profile is
 * reopened). Matches the full label or any slash-separated part of it,
 * case-insensitively: "Villain" -> Shadow / Villain, "mentor" -> Mentor /
 * Sage. Blank or unrecognized roles return "" (the Any role default).
 */
export function archetypeIdForRole(role: string | null | undefined): string {
  // EACH PART, not the whole field. Role became a comma list the moment it
  // started appending, and matching the whole string would mean this quietly
  // stopped working for exactly the writer who used the feature: "Merchant,
  // Red Herring, Everyman" matches no archetype label, so Quick Build would
  // silently lose its Story Role default. First match wins, in field order.
  for (const part of splitRoles(role)) {
    const norm = part.toLowerCase();
    if (!norm) continue;
    for (const o of ARCHETYPE_OPTIONS) {
      if (o.label.toLowerCase() === norm) return o.id;
      if (o.label.split("/").some(p2 => p2.trim().toLowerCase() === norm)) return o.id;
    }
    // A plain role name can carry an archetype too ("Everyman" -> everyman),
    // which is how the guidance stays reachable now the second dropdown is
    // gone.
    const option = roleOptionByName(part);
    if (option?.archetype) return option.archetype;
  }
  return "";
}

// ── Role-pick side effects ───────────────────────────────────────────────────
// Picking a Story Role also fills the profile's Role field and adds a few
// key-aspect Tags (deduped against existing ones). Keyed by SpineOption.id.

export const ARCHETYPE_ROLE_TAGS: Record<string, string[]> = {
  hero:         ["protagonist", "courage"],
  mentor:       ["wisdom", "guide"],
  caregiver:    ["nurturing", "protective"],
  explorer:     ["restless", "freedom"],
  rebel:        ["defiant", "disruptor"],
  lover:        ["devotion", "passion"],
  creator:      ["maker", "visionary"],
  jester:       ["humor", "truth-teller"],
  innocent:     ["sincere", "trusting"],
  everyman:     ["relatable", "grounded"],
  ruler:        ["authority", "control"],
  shadow:       ["antagonist", "dark mirror"],
  comic_relief: ["humor", "timing"],
  confidant:    ["trusted", "discreet"],
  rival:        ["competitor", "foil"],
};

// ── The role catalog ─────────────────────────────────────────────────────────
// Spec: docs/character-spine-spec.md section 6.3.
//
// GROUPED BY WHAT THE WRITER IS LOOKING FOR, not by how common it is. The old
// grouping was Popular / Less Common / Niche, and the report that killed it is
// simple: "Merchant" was not in the list at all. Neither were Innkeeper,
// Healer, Guard, Suspect or Witness. The list had grown out of story-theory
// vocabulary -- Threshold Guardian, Greek Chorus, Shapeshifter -- and never
// covered the ordinary people a world is full of.
//
// Frequency groups are also useless for finding anything. A writer knows they
// need somebody who sells things; they do not know whether that is Popular.
//
// `guidance` is the archetype's "weakness to write toward" line, on the roles
// that have one. It used to be reachable only through a second dropdown that
// overwrote the Role field; now it is offered where the role is chosen and
// inserted only when asked (spec 6.2).

export interface RoleOption {
  name: string;
  /** One line: what this role DOES in a story. Every role has one. */
  help: string;
  /** The archetype id whose guidance this role can insert, when there is one. */
  archetype?: string;
}

export const ROLE_CATALOG: { group: string; options: RoleOption[] }[] = [
  {
    group: "Leads",
    options: [
      { name: "Protagonist", help: "The story happens to them and through them.", archetype: "hero" },
      { name: "Deuteragonist", help: "The second lead; their own arc runs alongside." },
      { name: "Anti-hero", help: "Carries the story without deserving to." },
      { name: "Point-of-view character", help: "Whose eyes a section is seen through." },
    ],
  },
  {
    group: "Opposition",
    options: [
      { name: "Antagonist", help: "Wants what the lead wants, or wants them stopped.", archetype: "shadow" },
      { name: "Villain", help: "An antagonist the story judges.", archetype: "shadow" },
      { name: "Rival", help: "Competes on the same ground, not necessarily an enemy.", archetype: "rival" },
      { name: "Nemesis", help: "Personal, mutual, and older than this story." },
      { name: "Foil", help: "Exists to show what the lead is by not being it." },
      { name: "Henchman", help: "Carries out the opposition's will and has their own reasons." },
      { name: "Enforcer", help: "The threat made physical." },
    ],
  },
  {
    group: "Allies and companions",
    options: [
      { name: "Sidekick", help: "Along for it, and says the thing the lead will not." },
      { name: "Best Friend", help: "Knew them before the story started." },
      { name: "Confidant", help: "The one they tell the truth to.", archetype: "confidant" },
      { name: "Mentor", help: "Knows the cost already and cannot pay it again.", archetype: "mentor" },
      { name: "Guardian", help: "Stands between someone and harm." },
      { name: "Comic Relief", help: "Breaks the tension, usually on purpose.", archetype: "comic_relief" },
      { name: "Loyal Retainer", help: "Serves the house rather than the person." },
    ],
  },
  {
    group: "Family and household",
    options: [
      { name: "Parent Figure", help: "Raised them, or stood in for whoever did.", archetype: "caregiver" },
      { name: "Sibling", help: "Shares the history and remembers it differently." },
      { name: "Child", help: "What the adults are protecting, or failing to." },
      { name: "Spouse", help: "The relationship the story tests." },
      { name: "Estranged Relative", help: "Family by blood and nothing else, yet." },
      { name: "Servant", help: "In every room and counted as furniture." },
    ],
  },
  {
    group: "Love and attachment",
    options: [
      { name: "Love Interest", help: "What the lead wants and cannot simply take.", archetype: "lover" },
      { name: "Rival Suitor", help: "Wants the same person and is not a worse choice." },
      { name: "Former Lover", help: "Knows exactly where the bruises are." },
      { name: "Unrequited Admirer", help: "Loves without being seen doing it." },
    ],
  },
  {
    group: "Trade and community",
    options: [
      { name: "Merchant", help: "Sells what the story needs bought, and hears everything." },
      { name: "Innkeeper", help: "Where travellers meet and news changes hands." },
      { name: "Healer", help: "Decides who is worth saving and at what price." },
      { name: "Smith", help: "Makes the thing, and knows what it is for." },
      { name: "Guard", help: "The rule, standing in a doorway." },
      { name: "Employer", help: "Holds the lead's living in their hand." },
      { name: "Landlord", help: "Ordinary power over somewhere to sleep." },
      { name: "Neighbor", help: "Close enough to notice, not close enough to help." },
      { name: "Teacher", help: "Shapes what a character believes is possible." },
      { name: "Priest", help: "Speaks for whatever this world answers to." },
    ],
  },
  {
    group: "Mystery and misdirection",
    options: [
      { name: "Red Herring", help: "Looks guilty because the story needs somebody to." },
      { name: "Suspect", help: "Had reason, and will not say where they were." },
      { name: "Witness", help: "Saw part of it and understood less than they think." },
      { name: "Informant", help: "Sells what they know, and shades it." },
      { name: "Investigator", help: "Asks the questions the reader is asking." },
      { name: "Keeper of the Secret", help: "Knows, and has decided not to say." },
      { name: "Unreliable Narrator", help: "Tells it wrong, and not always knowingly." },
      { name: "Double Agent", help: "Loyal to someone, and it is not who you think." },
    ],
  },
  {
    group: "Power and institution",
    options: [
      { name: "Ruler", help: "Holds the authority and pays for holding it.", archetype: "ruler" },
      { name: "Official", help: "The institution with a face and a desk." },
      { name: "Commander", help: "Spends people to win things." },
      { name: "Soldier", help: "Carries out an order they did not choose." },
      { name: "Zealot", help: "Certain, and therefore capable of anything." },
      { name: "Spy", help: "Belongs everywhere and nowhere." },
      { name: "Judge", help: "Decides, and cannot be argued with afterwards." },
    ],
  },
  {
    group: "Structural and mythic",
    options: [
      { name: "Herald", help: "Brings the news that starts the story." },
      { name: "Threshold Guardian", help: "Tests whether the lead is ready to go on." },
      { name: "Shapeshifter", help: "Whose side they are on is the question." },
      { name: "Catalyst", help: "Changes everyone else and does not change." },
      { name: "Trickster", help: "Upends the order and tells the truth doing it.", archetype: "jester" },
      { name: "Scapegoat", help: "Carries a blame that belongs elsewhere." },
      { name: "Greek Chorus", help: "Comments on the story from inside it." },
      { name: "Narrator", help: "The voice telling it." },
      { name: "Wildcard", help: "Nobody, including them, knows what they will do." },
      { name: "Explorer", help: "Cannot stay, and the story goes where they go.", archetype: "explorer" },
      { name: "Rebel", help: "Against it, whatever it is.", archetype: "rebel" },
      { name: "Creator", help: "Makes the thing the story is about.", archetype: "creator" },
      { name: "Innocent", help: "Has not learned yet what everyone else has.", archetype: "innocent" },
      { name: "Everyman", help: "Ordinary and likable, so the reader trusts them.", archetype: "everyman" },
    ],
  },
  // ── ADULT ROLES, last on purpose ───────────────────────────────────────────
  //
  // Requested 2026-08-25: "add some [NSFW] roles starting from Mild not safe
  // for work roles to increasingly more hardcore to explicit to
  // graphic/fetish/bdsm/kink roles ... just want there to be the option for it
  // in the drop down, but at the bottom."
  //
  // Adult fiction is a genre this app is for, and a writer working in it needs
  // the same vocabulary as anyone else. Three rules held here:
  //
  //   LAST, AND LABELLED. Four groups at the end of the list, each named so a
  //   writer working on a general-audience book scrolls past them without
  //   reading any of it. Nothing above this comment changed position.
  //
  //   STORY FUNCTION, NOT DESCRIPTION. Every help line answers "what does this
  //   character DO in the book", exactly as the groups above do. These are
  //   labels for a character's part in a plot, not content.
  //
  //   ADULTS, AND CONSENT IS PART OF THE CRAFT. The power-exchange group names
  //   the roles that real practice treats as load-bearing (negotiation,
  //   safewords, aftercare) because leaving them out is how fiction in this
  //   space reads as written by someone who has not thought about it.
  {
    group: "Adult: attraction and tension",
    options: [
      { name: "Seducer", help: "Pursues deliberately, and enjoys the pursuit." },
      { name: "Forbidden Love Interest", help: "Wanted, and costly to want." },
      { name: "Illicit Affair Partner", help: "The relationship that has to stay hidden." },
      { name: "Slow Burn", help: "Wanted for a long time before anything happens." },
      { name: "Tease", help: "Offers and withdraws, and knows they are doing it." },
      { name: "Unavailable Object of Desire", help: "Wanted by someone who cannot have them." },
      { name: "Morning After", help: "The consequences, with a face." },
    ],
  },
  {
    group: "Adult: explicit",
    options: [
      { name: "Casual Lover", help: "No claim on each other, by agreement." },
      { name: "One-Night Encounter", help: "Present for one scene and changes something." },
      { name: "Friend With Benefits", help: "The friendship is the part at risk." },
      { name: "Experienced Initiator", help: "Knows what they are doing and sets the pace." },
      { name: "First Time Partner", help: "For whom this is new, and matters more than they say." },
      { name: "Rekindled Ex", help: "Knows the body and the arguments both." },
      { name: "Paid Companion", help: "Sells intimacy and keeps their own life separate." },
    ],
  },
  {
    group: "Adult: power exchange",
    options: [
      { name: "Dominant", help: "Holds the control that the other one hands over." },
      { name: "Submissive", help: "Gives up control on purpose, and sets the terms of it." },
      { name: "Switch", help: "Takes either side, which is its own kind of tension." },
      { name: "Brat", help: "Resists in order to be met, not to be obeyed." },
      { name: "Service Partner", help: "Devotion expressed as usefulness." },
      { name: "Negotiator", help: "The scene gets discussed before it happens, and they run that." },
      { name: "Safeword Keeper", help: "Watches for the limit the other one will not admit to." },
      { name: "Aftercare Partner", help: "Handles the comedown, which is where the character shows." },
      { name: "Rigger", help: "The craft is the point as much as the effect." },
    ],
  },
  {
    group: "Adult: fetish and taboo",
    options: [
      { name: "Fetishist", help: "One specific thing, and the story treats it seriously." },
      { name: "Voyeur", help: "Watches, and is changed by watching." },
      { name: "Exhibitionist", help: "Needs an audience, and chooses one." },
      { name: "Degradation Partner", help: "Words are the instrument; the trust underneath is the story." },
      { name: "Praise Partner", help: "Undone by approval rather than by force." },
      { name: "Roleplay Partner", help: "Plays someone else on purpose, and the mask slips." },
      { name: "Pet Play Partner", help: "A persona held between two people who both chose it." },
      { name: "Boundary Pusher", help: "Wants past a limit, and the story decides what that costs." },
      { name: "Procurer", help: "Arranges what others want and stays outside it." },
    ],
  },
];

/** The groups that carry adult content, named once so nothing has to guess. */
export const ADULT_ROLE_GROUPS = new Set([
  "Adult: attraction and tension",
  "Adult: explicit",
  "Adult: power exchange",
  "Adult: fetish and taboo",
]);

/** Every role name, flat -- for contract tests and lookups. */
export const ALL_ROLE_NAMES: string[] =
  ROLE_CATALOG.flatMap(g => g.options.map(o => o.name));

/**
 * The catalog with the adult groups left out.
 *
 * Not used by the picker today -- the writer asked for the groups to be
 * present and last, not gated. It exists because the app already has a
 * content_mode per project (general / mature / explicit), so gating is a
 * one-line change if that is ever wanted, and having the boundary NAMED here
 * beats rediscovering which groups counted.
 */
export const WORK_SAFE_ROLE_CATALOG = ROLE_CATALOG
  .filter(g => !ADULT_ROLE_GROUPS.has(g.group));

/** Look a role up by name, case-insensitively. */
export function roleOptionByName(name: string): RoleOption | undefined {
  const norm = name.trim().toLowerCase();
  return ROLE_CATALOG.flatMap(g => g.options)
    .find(o => o.name.toLowerCase() === norm);
}

/**
 * Split a Role field into its parts.
 *
 * Role stays ONE STRING (spec 6.1), so everything that reads it today -- the
 * Weave index, the sidebar rows, prompt builders -- keeps working with no
 * migration. This is the only place that knows it is a list.
 */
export function splitRoles(role: string | null | undefined): string[] {
  return (role ?? "").split(",").map(r => r.trim()).filter(Boolean);
}

/**
 * Add a role without losing the ones already there.
 *
 * THE REPORTED BUG: both role controls assigned rather than appended, so
 * picking Everyman on a character already marked "Merchant, Red Herring"
 * erased both. Returns the field UNCHANGED when the role is already present,
 * compared case-insensitively, so a second pick is a no-op rather than a
 * duplicate.
 */
export function addRole(existing: string | null | undefined, role: string): string {
  const parts = splitRoles(existing);
  const norm = role.trim().toLowerCase();
  if (!norm) return existing ?? "";
  if (parts.some(p => p.toLowerCase() === norm)) return existing ?? "";
  return [...parts, role.trim()].join(", ");
}
