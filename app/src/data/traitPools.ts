// data/traitPools.ts -- Curated pools for the side-character trait randomizer
// ============================================================================
// The quick-build panel rolls a handful of options per section (Physical /
// Mannerism / Voice / Want) from these pools; clicking an option inserts it
// into an editable box. Everything here is static text shipped with the app
// -- no AI calls, instant, hand-editable after insert.
//
// Pool tiers (the NSFW toggle semantics the writer chose):
//   - toggle OFF               -> `normal` options only; Explicit box greyed out
//   - toggle ON                -> `nsfw` options REPLACE normal ones
//   - toggle ON + Explicit box -> `explicit` options REPLACE the nsfw ones;
//     this spiciest tier favors fill-in-the-blank phrasing ("secretly wants
//     to be ____") so the writer personalizes instead of the app prescribing.
//
// Archetype weighting: ARCHETYPE_FLAVOR adds role-specific options to the
// FRONT of the shuffle for the chosen story role, so even random picks land
// vaguely coherent (pick Comic Relief -> mannerism rolls lean toward timing
// and quips). Flavor applies to the normal tier only -- NSFW tiers are
// already writer-opted-in and stay role-neutral.

export type TraitSection = "physical" | "mannerism" | "voice" | "want";

export interface TraitPool {
  normal: string[];
  nsfw: string[];
  explicit: string[];
}

export const TRAIT_POOLS: Record<TraitSection, TraitPool> = {
  physical: {
    normal: [
      "a gentle giant -- physically imposing, soft spoken",
      "impossibly perfect hair no matter the weather",
      "a permanent scowl that has nothing to do with their mood",
      "small and quick, always underfoot before anyone hears them",
      "an old injury that announces the weather before it turns",
      "dresses a full generation out of date, on purpose",
      "hands that never stop working on something",
      "a laugh you can locate from two rooms away",
      "immaculate except for one chaotic detail",
      "built like a scarecrow -- all angles and joints",
      "a face that looks familiar to absolutely everyone",
      "always slightly sunburned, whatever the season",
      "moves like they own the floor, even in someone else's house",
      "one gold tooth they will tell a different story about each time",
    ],
    nsfw: [
      "the kind of good-looking that makes people forget their errand",
      "dresses one notch too provocatively for every occasion",
      "a body kept gym-perfect purely to be looked at",
      "a slow, deliberate way of moving that reads as an invitation",
      "always a little undone -- one button, one strap, one glance",
      "scandalous ink that only shows when they want it to",
      "a mouth made for smirking and worse",
      "beautiful in a way they weaponize without apology",
    ],
    explicit: [
      "keeps ____ under their clothes that nobody in town would guess",
      "a body that shows exactly what ____ did to it, and they don't hide it",
      "dresses like ____ in public and like ____ when the door locks",
      "the marks of last night's ____ just barely covered",
      "openly wears the ____ that signals what they're into, if you know",
      "a physical tell -- ____ -- that gives them away when aroused",
    ],
  },

  mannerism: {
    normal: [
      "perfect comedic timing -- the quip lands exactly on the beat",
      "never finishes a sentence, trusts you to catch the drift",
      "polishes things that are already clean when nervous",
      "quotes their late spouse like scripture, twice a conversation",
      "counts things under their breath -- stairs, coins, people",
      "touches the doorframe twice before entering any room",
      "feeds everyone; refusing a plate is a declaration of war",
      "collects gossip like currency and spends it strategically",
      "apologizes to furniture when bumping into it",
      "writes everything on their palm and washes none of it off",
      "hums old songs slightly wrong, daring you to correct them",
      "always mid-card-trick, mid-coin-roll, hands never idle",
      "remembers everyone's order, name, and worst secret",
      "leaves every gathering exactly ten minutes before it ends",
    ],
    nsfw: [
      "flirts on reflex with anything that makes eye contact",
      "stands one step inside everyone's personal space and knows it",
      "turns any innocent sentence filthy with just a pause",
      "touches your arm mid-sentence and lets it linger a beat long",
      "undresses people with a glance and doesn't pretend otherwise",
      "keeps count of conquests somewhere -- and it shows",
      "bites their lip when scheming, and they are always scheming",
      "whispers things in public that belong behind locked doors",
    ],
    explicit: [
      "propositions ____ within minutes, as a kind of greeting",
      "has a tell when aroused: ____",
      "keeps a ____ in their bag and a story about it ready",
      "negotiates ____ with the calm of someone ordering coffee",
      "can't be in a room with ____ without steering the night there",
      "leaves ____ behind after every encounter, like a signature",
    ],
  },

  voice: {
    normal: [
      "dry one-liners delivered completely deadpan",
      "talks to strangers like regulars at a bar they own",
      "asks questions and never answers any",
      "swears in an inventive, oddly wholesome way",
      "speaks in stories that always circle back to a point -- eventually",
      "a whisper people lean into, which is exactly the plan",
      "narrates their own actions in the third person when annoyed",
      "chronically formal -- full names, no contractions, no exceptions",
      "argues both sides of everything and wins as neither",
      "speaks fluent bureaucracy and uses it as a weapon",
      "answers questions with proverbs that only half fit",
      "loud, warm, and incapable of a private conversation",
      "says less the angrier they get -- silence is the alarm",
      "an accent that thickens exactly when convenient",
    ],
    nsfw: [
      "a low bedroom register they can switch on mid-sentence",
      "compliments that are technically decent and entirely not",
      "double meanings in everything -- and the eye contact to confirm it",
      "talks about their exploits at brunch volume",
      "asks shockingly intimate questions with a straight face",
      "the vocabulary of a saint until the door closes",
      "purrs names instead of saying them",
      "narrates what they'd do to you as hypotheticals, smiling",
    ],
    explicit: [
      "describes ____ in loving detail to anyone who'll listen",
      "a filthy nickname for everyone -- yours is ____",
      "gives explicit, unsolicited advice about ____",
      "moans theatrically over ordinary pleasures like ____, in public",
      "recounts last night's ____ like a sports commentator",
      "propositions people with the exact phrase ____, every time",
    ],
  },

  want: {
    normal: [
      "wants to be taken seriously, just once, by anyone",
      "wants to know everyone's business -- purely for the collection",
      "wants the shop to outlive them and fears it won't",
      "wants an apology they will never ask for out loud",
      "wants to leave this town and has packed twice already",
      "wants to matter to the hero the way the hero matters to them",
      "wants their child to call more, and mentions it sideways",
      "wants the old days back and has edited them heavily",
      "wants to win the annual contest that nobody else takes seriously",
      "wants to be asked about the war, the tour, the glory days",
      "wants a quiet life and keeps volunteering for chaos anyway",
      "wants to finally beat their rival at something that counts",
      "wants forgiveness for a thing no one else remembers",
      "wants someone to inherit the secret before it dies with them",
    ],
    nsfw: [
      "wants someone to take them on a real date and then ravish them",
      "wants to be desired again, and tests it on everyone",
      "wants one reckless night that no one back home ever hears about",
      "wants the person they can't have, and circles them constantly",
      "wants to be pursued -- surrender is the whole fantasy",
      "wants an arrangement: no names, no mornings, no feelings",
      "wants to corrupt someone respectable, slowly",
      "wants to be someone's secret -- the thrill is the hiding",
    ],
    explicit: [
      "secretly wants to be ____ and would die before admitting it",
      "wants to be ____ by ____, and has planned it in detail",
      "wants to try ____ before they're too old to enjoy it",
      "wants a partner who will finally ____ without being asked",
      "wants to be caught doing ____ -- the risk is the point",
      "wants to serve as somebody's ____, on their knees if asked",
      "wants to own a ____ of their very own, trained and devoted",
    ],
  },
};

// ── Archetype flavor -- role-weighted extras for the NORMAL tier ─────────────
// Keyed by SpineOption.id from characterSpines.ts ARCHETYPE_OPTIONS. These
// get shuffled to the FRONT of the normal pool when that role is selected.

export const ARCHETYPE_FLAVOR: Partial<Record<string, Partial<Record<TraitSection, string[]>>>> = {
  comic_relief: {
    mannerism: [
      "enters every scene one beat after the perfect setup line",
      "mimes along behind authority figures with uncanny accuracy",
    ],
    voice: [
      "quips that land hardest when everything is falling apart",
      "puns so bad the groan is the applause",
    ],
    want: ["wants one laugh from the person who never laughs"],
  },
  mentor: {
    mannerism: ["answers questions by handing you a task instead"],
    voice: ["parables first, instructions only if you fail the parable"],
    want: ["wants the student to surpass them -- and dreads the day"],
  },
  caregiver: {
    mannerism: ["feeds everyone; refusing a plate is a declaration of war"],
    want: ["wants one person to notice they are running on empty"],
  },
  rival: {
    mannerism: ["keeps score out loud, in everything, always"],
    want: ["wants to finally beat their rival at something that counts"],
  },
  shadow: {
    voice: ["reasonable, patient, and always three sentences from a threat"],
    want: ["wants the hero to admit they were right about one thing"],
  },
  ruler: {
    mannerism: ["rearranges any table they sit at to face the door"],
    want: ["wants a successor and trusts no candidate, including family"],
  },
  confidant: {
    mannerism: ["pours the drink before the confession starts"],
    want: ["wants to unburden one secret they were never meant to keep"],
  },
};

// ── Rolling helper -- pure and injectable for tests ─────────────────────────

/**
 * Roll `count` visible options for a section.
 *
 * Tier selection implements the NSFW toggle semantics exactly (replace, not
 * mix): explicit > nsfw > normal. Archetype flavor applies to the normal
 * tier only. `rng` is injectable (defaults to Math.random) so tests can pin
 * the shuffle -- and the flavor bias is guaranteed by construction: flavored
 * options are drawn first, before the general pool is shuffled in.
 */
export function rollTraitOptions(
  section: TraitSection,
  count: number,
  opts: { nsfw?: boolean; explicit?: boolean; archetypeId?: string | null } = {},
  rng: () => number = Math.random,
): string[] {
  const pool = TRAIT_POOLS[section];
  let source: string[];
  if (opts.nsfw && opts.explicit) source = pool.explicit;
  else if (opts.nsfw)             source = pool.nsfw;
  else                            source = pool.normal;

  const shuffle = (arr: string[]) => {
    // Fisher-Yates on a copy -- unbiased, never mutates the pool.
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  if (!opts.nsfw && opts.archetypeId) {
    const flavor = ARCHETYPE_FLAVOR[opts.archetypeId]?.[section] ?? [];
    if (flavor.length > 0) {
      // Flavored options first (up to half the slots), general pool fills
      // the rest -- coherence without making every roll identical.
      const flavorPicks = shuffle(flavor).slice(0, Math.max(1, Math.floor(count / 2)));
      const rest = shuffle(source.filter(o => !flavorPicks.includes(o)))
        .slice(0, count - flavorPicks.length);
      return [...flavorPicks, ...rest];
    }
  }

  return shuffle(source).slice(0, count);
}
