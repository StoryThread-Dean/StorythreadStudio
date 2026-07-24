// data/characterSpines.ts -- Canned personality-spine content
// =============================================================
// The "spine" of a main character = WHO they are inside (Enneagram) + WHAT
// role they play in the story (archetype). Two dropdowns in the Profile
// Builder insert these summaries into an editable box -- writer-initiated,
// hand-editable, zero AI calls (this is static text shipped with the app).
//
// House style for every summary ("fiction-first", never the flattering
// personality-quiz register): behavior + speech pattern + how they crack
// under pressure, ending with a fill-in hook so the writer personalizes it.
// The formula everywhere: trait + trigger + origin.
//
// Naming note: deliberately Enneagram + Jungian archetypes. Do NOT add
// "Myers-Briggs"/"MBTI" naming anywhere -- trademarked. A 16-type list, if
// ever added, gets a generic label ("Personality Type (16-type)").

export interface SpineOption {
  id: string;      // stable key
  label: string;   // dropdown display
  help: string;    // one-line "What's this?" definition
  summary: string; // the fiction-first paragraph inserted on selection
}

// ── Enneagram -- the inner engine ────────────────────────────────────────────
// Each summary carries the type's core desire, core fear, and stress
// behavior, because that trio is motivation + arc fuel in one package.

export const ENNEAGRAM_OPTIONS: SpineOption[] = [
  {
    id: "e1",
    label: "1 -- The Reformer",
    help: "Principled and self-controlled; driven to be right and good.",
    summary:
      "Wants to be good and beyond reproach; dreads being corrupt or wrong. "
      + "Holds themselves and everyone nearby to a standard no one agreed to, "
      + "notices the crooked picture frame in any room, and apologizes rarely "
      + "but corrects often. Speech is precise, measured, lightly instructional. "
      + "Under pressure the inner critic turns outward: nitpicking becomes "
      + "resentment, resentment becomes cold fury at a world that will not "
      + "behave -- and this sharpens around ____ because ____.",
  },
  {
    id: "e2",
    label: "2 -- The Helper",
    help: "Warm and generous; needs to be needed.",
    summary:
      "Wants to be loved and indispensable; dreads being unwanted. Remembers "
      + "everyone's birthday, shows up with soup before being asked, and keeps "
      + "a silent ledger of favors no one else knows they owe. Speech is warm, "
      + "attentive, full of questions about you and deflections about them. "
      + "Under pressure the giving turns pointed: reminders of all they have "
      + "done, guilt served with a smile, love wielded as leverage -- and this "
      + "sharpens around ____ because ____.",
  },
  {
    id: "e3",
    label: "3 -- The Achiever",
    help: "Adaptable and driven; success is identity.",
    summary:
      "Wants to be admired as a success; dreads being worthless without the "
      + "trophies. Reads every room and becomes whatever wins it, works while "
      + "others sleep, and treats feelings as scheduling conflicts. Speech is "
      + "confident, polished, quietly always presenting. Under pressure the "
      + "mask cracks in private only: cutting corners, inflating wins, and "
      + "raging at anyone who saw them fail -- and this sharpens around ____ "
      + "because ____.",
  },
  {
    id: "e4",
    label: "4 -- The Individualist",
    help: "Expressive and deep; longs to be uniquely understood.",
    summary:
      "Wants an identity all their own; dreads being ordinary and overlooked. "
      + "Feels everything a size larger than everyone else, curates their "
      + "surroundings like a self-portrait, and half-treasures the melancholy "
      + "they complain about. Speech is vivid, personal, allergic to cliche. "
      + "Under pressure they withdraw into envy and dramatics, certain no one "
      + "has ever felt this and no one ever could -- and this sharpens around "
      + "____ because ____.",
  },
  {
    id: "e5",
    label: "5 -- The Investigator",
    help: "Private and cerebral; hoards knowledge, energy, and space.",
    summary:
      "Wants to be competent and self-sufficient; dreads being drained or "
      + "invaded. Watches from the edge of the room, knows more than they say "
      + "by a wide margin, and rations time with people like a scarce supply. "
      + "Speech is spare, exact, delivered after a pause that means thinking. "
      + "Under pressure they detach completely: hoarding information, vanishing "
      + "into work or theory while the house burns -- and this sharpens around "
      + "____ because ____.",
  },
  {
    id: "e6",
    label: "6 -- The Loyalist",
    help: "Committed and vigilant; scans for what could go wrong.",
    summary:
      "Wants security and someone worth trusting; dreads being abandoned "
      + "without support. Sees the exits in every room, stress-tests people "
      + "before relying on them, and is the steadiest hand in a real crisis "
      + "because they rehearsed it a hundred times. Speech runs to questions, "
      + "caveats, devil's-advocacy. Under pressure they either cling to "
      + "authority or lash out at it -- sometimes both in an hour -- and this "
      + "sharpens around ____ because ____.",
  },
  {
    id: "e7",
    label: "7 -- The Enthusiast",
    help: "Spontaneous and upbeat; runs from pain toward the next thing.",
    summary:
      "Wants to be delighted and free; dreads being trapped in pain or "
      + "boredom. Plans three adventures while finishing none, retells "
      + "disasters as comedies within the week, and keeps every option open "
      + "including the ones that hurt people. Speech is quick, funny, "
      + "topic-hopping. Under pressure the escape hatch becomes the whole "
      + "personality: excess, recklessness, and a smile stretched over panic "
      + "-- and this sharpens around ____ because ____.",
  },
  {
    id: "e8",
    label: "8 -- The Challenger",
    help: "Forceful and protective; control beats vulnerability.",
    summary:
      "Wants to be in control of their own fate; dreads being weak or at "
      + "someone's mercy. Fills doorways even when small, tests strangers "
      + "with bluntness to see who flinches, and guards their few chosen "
      + "people like territory. Speech is direct, loud-carrying, comfortable "
      + "with confrontation others tiptoe around. Under pressure force is the "
      + "answer to everything: intimidation, ultimatums, scorched earth before "
      + "surrender -- and this sharpens around ____ because ____.",
  },
  {
    id: "e9",
    label: "9 -- The Peacemaker",
    help: "Easygoing and steady; merges with others to keep the peace.",
    summary:
      "Wants inner peace and no conflict; dreads mattering so little that "
      + "asserting themselves ends in loss. Agrees to plans they hate, sees "
      + "every side until they cannot find their own, and absorbs the moods "
      + "of whoever is loudest. Speech is mild, meandering, quick to soothe. "
      + "Under pressure they do not explode -- they fog out: procrastinating, "
      + "going stubbornly passive, gone from the room while still sitting in "
      + "it -- and this sharpens around ____ because ____.",
  },
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
  const norm = (role ?? "").trim().toLowerCase();
  if (!norm) return "";
  for (const o of ARCHETYPE_OPTIONS) {
    if (o.label.toLowerCase() === norm) return o.id;
    if (o.label.split("/").some(part => part.trim().toLowerCase() === norm)) return o.id;
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

// ── Role field suggestions ───────────────────────────────────────────────────
// A quick-pick list for the Role [] field itself, grouped by how often the
// role turns up in fiction. Picking one fills the field; hand-typing always
// works. (These are STORY functions, broader than the archetype list --
// e.g. "Red Herring" is a role, not a personality.)

export const ROLE_SUGGESTIONS: { group: string; options: string[] }[] = [
  {
    group: "Popular",
    options: [
      "Protagonist", "Antagonist", "Love Interest", "Mentor", "Sidekick",
      "Villain", "Best Friend", "Parent Figure",
    ],
  },
  {
    group: "Less Common",
    options: [
      "Anti-hero", "Rival", "Confidant", "Comic Relief", "Foil",
      "Narrator", "Guardian", "Informant", "Employer", "Neighbor",
    ],
  },
  {
    group: "Niche",
    options: [
      "Red Herring", "Unreliable Narrator", "Catalyst", "Herald",
      "Threshold Guardian", "Shapeshifter", "Scapegoat", "Greek Chorus",
      "Wildcard", "Keeper of the Secret",
    ],
  },
];
