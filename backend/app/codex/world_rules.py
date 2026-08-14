# codex/world_rules.py -- the questions a world has not answered yet
# ===================================================================
# Unwoven is the one stop kind that is not about a mistake. Everything else
# in the scan finds something wrong; this finds something absent, and asks.
#
#     How does power pass when a ruler dies?
#     What does your magic cost, and who pays it?
#     What is the worst thing a person can be accused of?
#
# None of that is derivable from the manuscript. It is the ground the story
# stands on, and a writer who has not decided it discovers halfway through
# book two that they needed to.
#
# ---------------------------------------------------------------------------
# WHY A ROOT SYSTEM RATHER THAN A CHECKLIST
# ---------------------------------------------------------------------------
# A flat list of a hundred worldbuilding prompts is a chore. What makes this
# worth answering is that every answer OPENS the questions it implies and
# REACHES INTO other domains:
#
#     "Succession is decided by single combat"
#       unlocks  -> what stops every heir being murdered in childhood?
#       crosses  -> is kinslaying prosecuted?        (law)
#       crosses  -> does the faith sanctify it?      (religion)
#
# So the writer is not filling in a form. They are following a consequence,
# and the world grows visibly as they do.
#
# ---------------------------------------------------------------------------
# WHERE THIS LIVES, AND WHY IT MOVED
# ---------------------------------------------------------------------------
# The design put this corpus in the frontend beside characterSpines.ts. It is
# here instead, because deciding whether a question is ANSWERED means reading
# the Weave -- which Thread types exist, which sections have prose in them --
# and that is backend work. Keeping the corpus next to the check means one
# copy of the vocabulary rather than a corpus over there and a matching set
# of conditions over here that quietly disagree. The contract tests that were
# specified for the frontend version live in tests/test_world_rules.py.
#
# ---------------------------------------------------------------------------
# ANSWERED IS DERIVED, NEVER RECORDED
# ---------------------------------------------------------------------------
# A question is answered when the world contains its answer. Nothing marks a
# question done. Same rule as every other stop: the condition ends, so the stop
# ends. A writer who deletes the entry gets the question back, which is correct
# -- they no longer have an answer.
#
# What "contains its answer" means got sharper once the corpus grew. There are
# about fifty places an answer can land and a hundred questions to ask, so
# questions share landing places -- eleven of them land in a lore entry's "rule
# or concept", because that is genuinely where a rule about the world belongs.
# Reading content in that section as proof meant one entry about blood price
# silenced marriage, inheritance, war rules and forms of address at a stroke.
#
# So an answer records WHICH question it answers, as `answers:` in the entry's
# own frontmatter. That is still derivation from the writer's Markdown, not a
# ledger in the cache: it lives in their project, it survives deleting app.db,
# and it goes away when the entry does. Where a question owns its landing place
# outright, content alone still counts, because a writer who fills in a
# government's Succession section has answered how succession works and nobody
# hand-types a question id into a file.

from dataclasses import dataclass, field

__all__ = [
    "DOMAINS", "WORLD_RULES", "Question", "answered_domains", "by_id",
    "corpus_order", "open_questions",
]


@dataclass(frozen=True)
class Question:
    """
    One thing a world has to decide.

    `lands_as` is (type_id, section_id): where the answer belongs. It is what
    makes an answer part of the Weave rather than a separate pile of notes
    nothing else can read.
    """
    id: str
    domain: str
    prompt: str
    why: str
    lands_as: tuple[str, str]
    depth: int = 1
    # Children this answer opens. They are not asked until it is answered --
    # "what stops every heir being murdered" makes no sense before you have
    # said how succession works.
    unlocks: tuple[str, ...] = ()
    # Questions in OTHER domains this one touches. Shown as context, never as
    # a prerequisite: a world is a web, not a tree, and blocking on a
    # crosslink would deadlock two questions that each imply the other.
    crosslinks: tuple[str, ...] = ()


DOMAINS: dict[str, str] = {
    "governance": "Power and who holds it",
    "law": "Law and justice",
    "economy": "Money, trade and work",
    "religion": "Belief and the sacred",
    "power_system": "The power system and its cost",
    "kinship": "Family, marriage and inheritance",
    "war": "War and violence",
    "language": "Language and naming",
    "geography": "Land and travel",
    "memory": "Time, records and memory",
}


def _q(qid, domain, prompt, why, lands_as, depth=1, unlocks=(), crosslinks=()):
    return Question(qid, domain, prompt, why, lands_as, depth,
                    tuple(unlocks), tuple(crosslinks))


# The trunk (depth 1) and the branches it opens (depth 2). Written as
# questions a novelist would actually ask themselves, not as taxonomy: "what
# does magic cost" is a story problem, "magical energy taxonomy" is not.
WORLD_RULES: tuple[Question, ...] = (
    # ── Governance ──────────────────────────────────────────────────────
    _q("gov_power", "governance",
       "Who actually holds power here, and how did they get it?",
       "Almost every conflict in a story is somebody wanting something "
       "somebody else controls. Knowing who holds what makes those conflicts "
       "specific instead of vague.",
       ("government", "overview"),
       unlocks=["gov_succession", "gov_challenge"]),
    _q("gov_succession", "governance",
       "When the person in charge dies, how is the next one decided?",
       "Succession is where politics turns into plot. It also decides who "
       "has a motive the moment somebody gets ill.",
       ("government", "succession"), depth=2,
       unlocks=["gov_heirs"],
       crosslinks=["law_worst_crime", "kin_inheritance", "rel_sanction"]),
    _q("gov_heirs", "governance",
       "What stops every rival heir being killed in childhood?",
       "If your succession rule rewards murder and nothing prevents it, your "
       "world should already be empty. Whatever the answer is, it is a "
       "structure other characters live inside.",
       ("government", "structure"), depth=3,
       crosslinks=["law_worst_crime", "rel_sanction"]),
    _q("gov_challenge", "governance",
       "Who is allowed to say no to the people in charge, and what happens "
       "to them?",
       "The cost of dissent sets the temperature of every political scene "
       "you write. It is the difference between a grumble in a tavern and a "
       "whisper behind a locked door.",
       ("government", "laws"), depth=2,
       unlocks=["gov_removed"],
       crosslinks=["law_enforcement"]),

    # ── Law ─────────────────────────────────────────────────────────────
    _q("law_worst_crime", "law",
       "What is the worst thing a person can be accused of here?",
       "The worst crime tells your reader what the culture fears most, in "
       "one line and without a lecture. It is also the accusation that ends "
       "a character.",
       ("lore", "overview"),
       unlocks=["law_proof"],
       crosslinks=["rel_sin", "war_rules"]),
    _q("law_enforcement", "law",
       "Who enforces the rules day to day, and are they trusted?",
       "This decides whether your characters can call for help, and whether "
       "calling for help makes things worse.",
       ("faction", "overview"),
       crosslinks=["gov_challenge", "eco_who_owns"]),
    _q("law_proof", "law",
       "How is guilt decided -- evidence, oath, ordeal, confession?",
       "Every trial scene, every false accusation and every cover-up runs on "
       "this. It also decides whether the truth matters.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["rel_sanction", "mem_records"]),

    # ── Economy ─────────────────────────────────────────────────────────
    _q("eco_who_owns", "economy",
       "Who owns the land and the work, and who does not?",
       "Ownership is where quiet, permanent conflict lives. It tells you who "
       "cannot simply leave.",
       ("lore", "overview"),
       unlocks=["eco_debt"],
       crosslinks=["kin_inheritance"]),
    _q("eco_scarce", "economy",
       "What is scarce here that people elsewhere take for granted?",
       "Scarcity makes a place feel real faster than any description does, "
       "and gives everyone in it something to want.",
       ("location", "overview"),
       crosslinks=["geo_travel"]),
    _q("eco_debt", "economy",
       "What happens to someone who cannot pay what they owe?",
       "Debt is a plot engine that needs no villain. The answer tells you "
       "how far a desperate character will go.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["law_worst_crime"]),

    # ── Religion ────────────────────────────────────────────────────────
    _q("rel_belief", "religion",
       "What do most people here believe happens after death?",
       "It changes how your characters grieve, what they risk, and what a "
       "threat actually means to them.",
       ("religion", "beliefs"),
       unlocks=["rel_sin", "rel_sanction"],
       crosslinks=["mem_ancestors"]),
    _q("rel_practice", "religion",
       "What does an ordinary person do about it in an ordinary week?",
       "Belief a reader can see is worth more than belief a reader is told "
       "about. This is where a faith becomes texture rather than backstory.",
       ("religion", "practices"),
       crosslinks=["mem_calendar"]),
    _q("rel_sin", "religion",
       "What is forbidden, and who decides that it was?",
       "A rule with no enforcer is scenery. A rule with one is a character "
       "with power over your cast.",
       ("religion", "beliefs"), depth=2,
       crosslinks=["law_worst_crime"]),
    _q("rel_sanction", "religion",
       "Does the faith bless what the powerful do, or judge it?",
       "Where religion and power sit relative to each other decides whether "
       "your priest is a threat, a refuge, or an accomplice.",
       ("religion", "overview"), depth=2,
       crosslinks=["gov_power", "law_proof"]),

    # ── The power system and its cost ───────────────────────────────────
    _q("pow_what", "power_system",
       "What can be done here that cannot be done in our world?",
       "Say it plainly once, for yourself. A power you have not defined "
       "expands to solve every problem, and a story where nothing can go "
       "wrong is not a story.",
       ("concept", "overview"),
       unlocks=["pow_cost", "pow_who", "pow_learn"]),
    _q("pow_cost", "power_system",
       "What does it cost, and who pays -- the user, or somebody else?",
       "Cost is what makes a power interesting. A cost somebody ELSE pays is "
       "what makes it a moral problem.",
       ("concept", "details"), depth=2,
       unlocks=["pow_limit"],
       crosslinks=["rel_sin", "eco_scarce"]),
    _q("pow_who", "power_system",
       "Who is allowed to use it, and what happens to those who are not?",
       "Access to power is social, not just magical. This is usually where "
       "your world's real hierarchy shows.",
       ("concept", "details"), depth=2,
       crosslinks=["gov_power", "eco_who_owns"]),
    _q("pow_limit", "power_system",
       "What is the one thing it definitely cannot do?",
       "The limit is what your reader trusts. Without it, every rescue reads "
       "as convenient, however hard it was to write.",
       ("concept", "details"), depth=3),

    # ── Kinship ─────────────────────────────────────────────────────────
    _q("kin_family", "kinship",
       "What counts as a family here, and who decides?",
       "It sets who owes whom, who can be disowned, and who is a stranger "
       "despite the blood.",
       ("lore", "overview"),
       unlocks=["kin_inheritance"],
       crosslinks=["rel_practice"]),
    _q("kin_marriage", "kinship",
       "How are partnerships made and unmade, and by whom?",
       "Marriage rules are where love stories meet politics. They also "
       "decide whether leaving is possible.",
       ("lore", "rule_or_concept"),
       crosslinks=["rel_sanction", "law_enforcement"]),
    _q("kin_inheritance", "kinship",
       "What passes down, and to which of the children?",
       "Inheritance is motive in its purest form, and it is the reason "
       "siblings in fiction are so rarely friends.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["gov_succession", "eco_who_owns"]),

    # ── War ─────────────────────────────────────────────────────────────
    _q("war_who", "war",
       "Who does the fighting, and did they choose to?",
       "A professional army, a levy and a militia produce completely "
       "different scenes, and completely different griefs.",
       ("faction", "structure"),
       unlocks=["war_rules"],
       crosslinks=["gov_power"]),
    _q("war_rules", "war",
       "What is considered unforgivable even in war?",
       "Every culture draws a line somewhere. Crossing it is one of the "
       "strongest things a character can do.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["law_worst_crime", "rel_sin"]),

    # ── Language ────────────────────────────────────────────────────────
    _q("lang_names", "language",
       "How are people named here -- by parent, by place, by deed?",
       "A naming rule makes every new name you invent sound like it belongs, "
       "and it lets a reader tell an outsider from a local in one word.",
       ("lore", "overview"),
       unlocks=["lang_address"]),
    _q("lang_address", "language",
       "How do people address someone above and below them?",
       "Forms of address carry a whole hierarchy in two syllables, without a "
       "paragraph of explanation.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["gov_power"]),
    _q("lang_tongues", "language",
       "Is there more than one language, and who is excluded by that?",
       "Language is a border people carry with them. Who cannot understand a "
       "scene is often more interesting than who can.",
       ("lore", "rule_or_concept"),
       crosslinks=["geo_travel"]),

    # ── Geography ───────────────────────────────────────────────────────
    _q("geo_travel", "geography",
       "How long does it take to get from one important place to another?",
       "Travel time is the invisible clock behind every plan, every rescue "
       "and every piece of news that arrives too late.",
       ("location", "overview"),
       unlocks=["geo_news"],
       crosslinks=["eco_scarce"]),
    _q("geo_edge", "geography",
       "What is beyond the edge of the map, and what do people say is there?",
       "What a culture believes about the unknown says more about the "
       "culture than about the unknown.",
       ("location", "historical_significance"),
       crosslinks=["rel_belief"]),
    _q("geo_news", "geography",
       "How does news travel, and how much does it change on the way?",
       "Whether your characters can know something yet is a plot constraint "
       "you will otherwise break by accident.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["mem_records"]),

    # ── Memory ──────────────────────────────────────────────────────────
    _q("mem_calendar", "memory",
       "How is time counted here, and from what event?",
       "What a culture counts from is what it thinks its story began with. "
       "It also stops your dates contradicting each other.",
       ("lore", "overview"),
       crosslinks=["rel_practice"]),
    _q("mem_records", "memory",
       "What is written down, and who is allowed to read it?",
       "Records decide what can be proven, and literacy decides who can be "
       "lied to.",
       ("lore", "rule_or_concept"),
       unlocks=["mem_forgotten"],
       crosslinks=["law_proof", "geo_news"]),
    _q("mem_ancestors", "memory",
       "How are the dead remembered, and for how long?",
       "It tells you what a legacy is worth here, which is what most "
       "ambitious characters are actually chasing.",
       ("lore", "rule_or_concept"),
       crosslinks=["rel_belief"]),
    _q("mem_forgotten", "memory",
       "What has this world forgotten that the reader will learn?",
       "A gap in a world's memory is where a reveal comes from. Deciding it "
       "early means the clues can be there from chapter one.",
       ("lore", "rule_or_concept"), depth=2),

    # ═══════════════════════════════════════════════════════════════════════
    # R6.3 -- THE REST OF EACH DOMAIN
    # ═══════════════════════════════════════════════════════════════════════
    # The corpus shipped with three or four questions per domain, which is not
    # a domain, it is a sample of one. A writer who answered all four of
    # Governance had not decided how power works here; they had decided four
    # things about it, and the app then had nothing left to ask.
    #
    # About ten each, and they are chosen to be ANSWERABLE IN A SENTENCE by
    # somebody who has not thought about it before. That is the test each one
    # had to pass: not "is this interesting worldbuilding" but "could a
    # novelist mid-draft answer this in the time it takes to type a line, and
    # be glad they had". Questions that need an essay get skipped, and a walk
    # people skip is a walk they stop opening.

    # ── Governance ──────────────────────────────────────────────────────
    _q("gov_money", "governance",
       "Where does the money that keeps power in place come from?",
       "Power costs something to hold, and whoever supplies that has a grip "
       "on it. It is also the first thing an enemy would go after.",
       ("government", "structure"),
       unlocks=["gov_corrupt"],
       crosslinks=["eco_who_owns", "war_who"]),
    _q("gov_corrupt", "governance",
       "What does it take to buy a decision here, and who can afford it?",
       "Whether a bribe is unthinkable, routine or simply expensive changes "
       "every scene where a character needs something from an official.",
       ("government", "laws"), depth=2,
       crosslinks=["eco_debt", "law_enforcement"]),
    _q("gov_local", "governance",
       "Who is in charge of an ordinary village, far from the capital?",
       "Most scenes happen a long way from a throne room. The person with "
       "authority in the room is usually a local one, and rarely the same "
       "kind of person.",
       ("government", "structure"),
       crosslinks=["law_enforcement", "geo_travel"]),
    _q("gov_borders", "governance",
       "Who else claims authority over the same ground?",
       "Two claims on one place is a story that has already started. It gives "
       "you a conflict that needs no villain to explain it.",
       ("faction", "goals"),
       unlocks=["gov_treaty"],
       crosslinks=["war_who", "geo_edge"]),
    _q("gov_treaty", "governance",
       "What agreement keeps those claims from becoming a war, and how "
       "fragile is it?",
       "An agreement about to break is one of the most useful things a "
       "background can hold, because your plot can break it at any moment.",
       ("faction", "goals"), depth=2,
       crosslinks=["war_who", "mem_records"]),
    _q("gov_removed", "governance",
       "How is somebody in power removed when they will not go?",
       "Every political story eventually asks this. Whether the answer is a "
       "vote, a knife or nothing at all decides what your characters can even "
       "attempt.",
       ("government", "succession"), depth=2,
       crosslinks=["law_proof", "war_who"]),

    # ── Law ─────────────────────────────────────────────────────────────
    _q("law_punish", "law",
       "What happens to somebody found guilty, and does anyone come back "
       "from it?",
       "A punishment a character can survive and one they cannot are two "
       "completely different stakes, and readers judge a world by which it "
       "uses.",
       ("government", "laws"),
       unlocks=["law_mercy"],
       crosslinks=["eco_debt", "rel_sin"]),
    _q("law_mercy", "law",
       "Who can forgive a crime, and what does forgiveness cost?",
       "Mercy that anyone can grant is worthless and mercy nobody can grant "
       "is despair. Whoever holds it has power over your whole cast.",
       ("government", "laws"), depth=2,
       crosslinks=["rel_sanction", "gov_power"]),
    _q("law_outsider", "law",
       "Does the law treat a stranger the same as somebody born here?",
       "Your travelling characters live or die on this, and it tells a reader "
       "what the place thinks of the world outside it.",
       ("culture", "values"),
       crosslinks=["lang_tongues", "geo_travel"]),
    _q("law_private", "law",
       "What do people settle themselves rather than take to anyone?",
       "The line between a private matter and a public one is where feuds "
       "live, and it explains why nobody in your story called for help.",
       ("culture", "customs"),
       crosslinks=["kin_family", "war_rules"]),
    _q("law_oath", "law",
       "What promise is binding here, and what breaks it?",
       "A world where a spoken word holds and a world where only paper holds "
       "produce different liars, and different betrayals.",
       ("culture", "customs"),
       unlocks=["law_witness"],
       crosslinks=["rel_belief", "mem_records"]),
    _q("law_witness", "law",
       "Whose word counts here, and whose does not?",
       "Somebody who cannot be believed by law is somebody your plot can hurt "
       "with no risk to whoever hurt them. That is a whole character.",
       ("culture", "values"), depth=2,
       crosslinks=["kin_family", "eco_who_owns"]),
    _q("law_written", "law",
       "Can an ordinary person find out what the law actually says?",
       "A rule nobody can look up is a rule that means whatever the person "
       "enforcing it says it means, which is a very particular kind of fear.",
       ("government", "laws"),
       crosslinks=["mem_records", "lang_tongues"]),

    # ── Economy ─────────────────────────────────────────────────────────
    _q("eco_money", "economy",
       "What do people use for money, and does everyone accept it?",
       "It decides whether your characters can pay for the thing they need, "
       "and coin refused at a border is a scene in itself.",
       ("concept", "overview"),
       unlocks=["eco_trust"],
       crosslinks=["geo_travel", "gov_power"]),
    _q("eco_trust", "economy",
       "Who guarantees that money is worth anything, and what happens when "
       "they fail?",
       "Money is a promise somebody makes. Deciding who makes it tells you "
       "who can ruin everyone at once, which is a plot most worlds never use.",
       ("concept", "details"), depth=2,
       crosslinks=["gov_power", "mem_records"]),
    _q("eco_work", "economy",
       "What does an ordinary person here do all day?",
       "It is the fastest way to stop a world feeling like a stage set, and "
       "it gives every background character something to be interrupted from.",
       ("culture", "customs"),
       crosslinks=["kin_family", "rel_practice"]),
    _q("eco_trade", "economy",
       "What does this place sell to the outside world, and what must it buy?",
       "What a place needs from elsewhere is what it can be starved of, and "
       "what it sells is who it cannot afford to offend.",
       ("location", "cultural_significance"),
       unlocks=["eco_route"],
       crosslinks=["geo_travel", "war_who"]),
    _q("eco_route", "economy",
       "Who controls the road that trade takes, and what do they charge?",
       "Whoever sits on the route has power without any title, which is often "
       "the most interesting kind of power in a story.",
       ("faction", "goals"), depth=2,
       crosslinks=["gov_power", "war_who"]),
    _q("eco_poor", "economy",
       "What happens to somebody with nothing at all?",
       "Where the floor is decides how frightening falling is, and it is what "
       "your desperate characters are actually running from.",
       ("culture", "values"),
       crosslinks=["rel_practice", "law_private"]),
    _q("eco_guild", "economy",
       "Who is allowed to learn a trade, and who teaches them?",
       "Skill is inherited, bought or granted, and each of those makes a "
       "different world. It also decides who your character could have been.",
       ("faction", "structure"),
       crosslinks=["kin_inheritance", "lang_address"]),

    # ── Religion ────────────────────────────────────────────────────────
    _q("rel_gods", "religion",
       "Is there a god here, and does anyone claim to have met one?",
       "Whether the divine is present, absent or merely asserted changes what "
       "faith means for every believer you write.",
       ("deity", "overview"),
       unlocks=["rel_proof", "rel_priest"],
       crosslinks=["pow_what"]),
    _q("rel_proof", "religion",
       "Does the faith produce anything a sceptic cannot explain away?",
       "This is the difference between a religion your reader can doubt along "
       "with a character and one they simply have to accept.",
       ("deity", "domain"), depth=2,
       crosslinks=["pow_cost", "mem_forgotten"]),
    _q("rel_priest", "religion",
       "Who speaks for the faith, and how did they get the job?",
       "Bought, born to it, chosen or self-appointed: each makes a different "
       "person, and that person will be in your scenes.",
       ("religion", "practices"), depth=2,
       crosslinks=["gov_power", "eco_guild"]),
    _q("rel_other", "religion",
       "What happens to somebody who believes something else?",
       "How a faith treats the wrong belief is how it treats your outsider "
       "character, and it is where quiet persecution shows up in ordinary "
       "scenes.",
       ("religion", "overview"),
       crosslinks=["law_outsider", "war_rules"]),
    _q("rel_holy_place", "religion",
       "Where is the place that matters most, and who is allowed inside it?",
       "A threshold somebody may not cross is a scene waiting to happen, and "
       "it puts your faith on the map rather than in the abstract.",
       ("location", "cultural_significance"),
       crosslinks=["geo_travel", "gov_power"]),
    _q("rel_doubt", "religion",
       "What do people here do when the faith fails them?",
       "Every believer you write will eventually have a bad night. What their "
       "culture offers them then says more than any doctrine.",
       ("culture", "values"),
       crosslinks=["mem_ancestors", "law_oath"]),

    # ── The power system and its cost ───────────────────────────────────
    _q("pow_learn", "power_system",
       "How does somebody learn to use it, and how long does that take?",
       "It decides whether your character can plausibly gain this mid-story, "
       "which is the single most common way a power system breaks a plot.",
       ("lore", "rule_or_concept"), depth=2,
       crosslinks=["eco_guild", "kin_inheritance"]),
    _q("pow_visible", "power_system",
       "Can an ordinary person tell when it is being used?",
       "Hidden power and obvious power make completely different societies, "
       "and it decides whether your character can use it in a crowded room.",
       ("lore", "what_it_affects"),
       crosslinks=["law_proof", "war_who"]),
    _q("pow_fail", "power_system",
       "What does it look like when it goes wrong?",
       "Failure is where a power system becomes frightening rather than "
       "convenient, and readers remember the wreckage far longer than the "
       "rules.",
       ("lore", "story_relevance"),
       crosslinks=["rel_sin", "mem_forgotten"]),
    _q("pow_known", "power_system",
       "How much does an ordinary person actually know about it?",
       "The gap between what is true and what people believe is true is where "
       "rumour, fear and false confidence come from.",
       ("lore", "what_characters_know"),
       crosslinks=["lang_tongues", "mem_records"]),
    _q("pow_object", "power_system",
       "Is there a thing that holds it, and what happens if it is stolen?",
       "A power you can carry is a power somebody can take, which turns an "
       "abstract rule into something your plot can physically move.",
       ("object", "significance"),
       crosslinks=["eco_scarce", "war_who"]),
    _q("pow_change", "power_system",
       "Has it always worked this way?",
       "A system that changed once can change again, and saying when it "
       "changed hands your reader a past worth being curious about.",
       ("lore", "story_relevance"),
       crosslinks=["mem_forgotten", "geo_edge"]),

    # ── Kinship ─────────────────────────────────────────────────────────
    _q("kin_children", "kinship",
       "Who raises the children, and who decides what becomes of them?",
       "Whether a child belongs to a parent, a household or the whole place "
       "changes every childhood you write, including your protagonist's.",
       ("culture", "customs"),
       unlocks=["kin_coming_of_age"],
       crosslinks=["eco_work", "rel_practice"]),
    _q("kin_coming_of_age", "kinship",
       "When does a child become an adult here, and what marks it?",
       "It gives you a moment every character has been through, which is one "
       "of the cheapest and best pieces of shared history a world can have.",
       ("culture", "customs"), depth=2,
       crosslinks=["rel_practice", "war_who"]),
    _q("kin_household", "kinship",
       "Who lives under one roof, and who is not welcome there?",
       "The shape of a household decides who overhears things, which is most "
       "of how information moves in a domestic scene.",
       ("culture", "customs"),
       crosslinks=["eco_poor", "law_private"]),
    _q("kin_elders", "kinship",
       "What happens to somebody too old to work?",
       "How a place treats its old people is how it will treat your character "
       "eventually, and readers feel that even when nobody says it.",
       ("culture", "values"),
       crosslinks=["eco_poor", "rel_belief"]),
    _q("kin_outsider", "kinship",
       "How does somebody join a family they were not born into?",
       "Marriage, adoption, oath or never: this is the door your outsider "
       "character is standing at, and whether it opens is a whole plot.",
       ("culture", "customs"),
       crosslinks=["law_outsider", "rel_sanction"]),
    _q("kin_name_line", "kinship",
       "Whose name does a child take, and what does that decide?",
       "A name that carries property or duty makes naming a decision rather "
       "than a formality, and gives you a fight worth having.",
       ("culture", "customs"),
       crosslinks=["lang_names", "eco_who_owns"]),
    _q("kin_barren", "kinship",
       "What does a family do when there is no heir?",
       "The answer is where adoption, scandal, forgery and murder all come "
       "from, and every succession story needs it decided in advance.",
       ("culture", "values"),
       crosslinks=["gov_succession", "rel_practice"]),

    # ── War ─────────────────────────────────────────────────────────────
    _q("war_last", "war",
       "When was the last war here, and is anyone still alive who saw it?",
       "A war inside living memory is present in every room. One nobody "
       "remembers is a different world entirely.",
       ("event", "overview"),
       unlocks=["war_scars"],
       crosslinks=["mem_ancestors", "gov_power"]),
    _q("war_scars", "war",
       "What did that war leave behind that people still live with?",
       "Ruins, debts, missing generations and hatreds are what make a past "
       "war matter to a story set long after it.",
       ("event", "consequences"), depth=2,
       crosslinks=["eco_poor", "geo_edge"]),
    _q("war_weapons", "war",
       "What is the most dangerous thing anyone can bring to a fight?",
       "It sets the ceiling on every fight scene you write, and decides "
       "whether your hero can walk into a room and win.",
       ("object", "significance"),
       crosslinks=["pow_what", "eco_trade"]),
    _q("war_peace", "war",
       "How does a fight here end short of somebody dying?",
       "Surrender, ransom, a formal word, or nothing: without this every "
       "confrontation you write has only one exit.",
       ("culture", "customs"),
       crosslinks=["law_private", "rel_sanction"]),
    _q("war_prisoners", "war",
       "What happens to somebody taken alive?",
       "It decides whether being captured is a delay or an ending, which is "
       "the difference between tension and dread.",
       ("culture", "values"),
       crosslinks=["law_punish", "eco_who_owns"]),
    _q("war_home", "war",
       "What happens to the people who did not fight?",
       "Most of your cast will be these people. What war does to them is what "
       "war means in your book.",
       ("culture", "values"),
       crosslinks=["eco_work", "kin_household"]),
    _q("war_honour", "war",
       "What does a fighter here want said about them afterwards?",
       "It gives you what a soldier is afraid of that is not dying, and that "
       "is usually the more useful fear.",
       ("culture", "values"),
       crosslinks=["mem_ancestors", "rel_belief"]),
    _q("war_command", "war",
       "Who gives the orders, and what happens if they are refused?",
       "The cost of saying no is where a war story finds its moral scenes, "
       "and it is decided long before the battle.",
       ("faction", "structure"),
       crosslinks=["gov_power", "law_oath"]),

    # ── Language ────────────────────────────────────────────────────────
    _q("lang_script", "language",
       "Is it written down, and does the writing look like the speech?",
       "A script nobody can sound out is a puzzle for your characters, and a "
       "script that matches speech is a world where a child can learn fast.",
       ("language", "sound_and_script"),
       unlocks=["lang_literate"],
       crosslinks=["mem_records", "law_written"]),
    _q("lang_literate", "language",
       "Who can read it, and what does being able to read let them do?",
       "Literacy is quiet power. It decides who can be deceived by a document "
       "and who can write one.",
       ("language", "overview"), depth=2,
       crosslinks=["mem_records", "gov_power"]),
    _q("lang_sound", "language",
       "What does this language sound like to somebody who does not speak it?",
       "One line here makes every name you invent afterwards sound like it "
       "came from the same place, which is most of what a language does for a "
       "reader.",
       ("language", "sound_and_script"),
       crosslinks=["geo_edge", "rel_practice"]),
    _q("lang_swear", "language",
       "What do people say when something goes badly wrong?",
       "What a culture curses by is what it holds sacred, and it is the "
       "fastest piece of worldbuilding a reader will ever absorb.",
       ("culture", "customs"),
       crosslinks=["rel_belief", "law_oath"]),
    _q("lang_slang", "language",
       "What words does one group here use that another would not?",
       "It lets a reader place a character by a single word, and gives you a "
       "way to show somebody pretending to be what they are not.",
       ("culture", "customs"),
       crosslinks=["eco_work", "war_who"]),
    _q("lang_forbidden", "language",
       "Is there anything that must not be said out loud?",
       "A forbidden word makes silence meaningful, and gives you a line a "
       "character can cross by speaking one sentence.",
       ("culture", "values"),
       crosslinks=["rel_sin", "pow_known"]),
    _q("lang_old", "language",
       "Is there an older form of the language, and where does it survive?",
       "Old words in ritual, law or insults are how a reader feels the depth "
       "of a past without being told any of it.",
       ("language", "overview"),
       crosslinks=["mem_forgotten", "rel_practice"]),

    # ── Geography ───────────────────────────────────────────────────────
    _q("geo_home", "geography",
       "Where does most of your story happen, and what does it look like at "
       "dawn?",
       "One concrete image of the main place beats a page of description, and "
       "you will reach for it in every chapter.",
       ("location", "physical_description"),
       unlocks=["geo_season"],
       crosslinks=["eco_work", "war_home"]),
    _q("geo_season", "geography",
       "What does the year do to that place?",
       "Weather is the cheapest source of pressure a story has, and a place "
       "with seasons has a different problem every few chapters.",
       ("location", "tone_and_atmosphere"), depth=2,
       crosslinks=["eco_scarce", "mem_calendar"]),
    _q("geo_danger", "geography",
       "What part of this land do people avoid, and why?",
       "An avoided place is a promise to your reader, and the reason people "
       "give is rarely the whole reason.",
       ("location", "tone_and_atmosphere"),
       crosslinks=["rel_belief", "pow_fail"]),
    _q("geo_water", "geography",
       "Where does the water come from, and who controls it?",
       "Every settlement in history sits where it does because of this, and "
       "whoever holds it can end a siege without fighting.",
       ("location", "physical_description"),
       crosslinks=["eco_who_owns", "war_who"]),
    _q("geo_city", "geography",
       "What is the biggest place anyone here has ever been to?",
       "It sets the size of your characters' world, and the gap between that "
       "and the reader's is where wonder comes from.",
       ("location", "overview"),
       crosslinks=["eco_trade", "gov_power"]),
    _q("geo_road", "geography",
       "What is travelling actually like: who goes armed, and who does not go "
       "at all?",
       "It turns a journey from a line on a map into a decision with a cost, "
       "which is what makes travel scenes worth writing.",
       ("location", "scene_use_notes"),
       crosslinks=["war_who", "eco_poor"]),
    _q("geo_creature", "geography",
       "What lives out there that a traveller needs to know about?",
       "One creature everyone can name does more for a landscape than a full "
       "bestiary nobody has met.",
       ("creature", "behaviour"),
       crosslinks=["pow_what", "rel_belief"]),

    # ── Memory ──────────────────────────────────────────────────────────
    _q("mem_founding", "memory",
       "What story does this place tell about how it began?",
       "A founding story is what a culture wants to be true about itself, and "
       "characters quote it without thinking.",
       ("event", "overview"),
       unlocks=["mem_founding_true"],
       crosslinks=["rel_belief", "gov_power"]),
    _q("mem_founding_true", "memory",
       "How much of that story is true, and who knows the difference?",
       "The gap between the official past and the real one is where a great "
       "many plots live, and somebody always knows.",
       ("event", "what_happened"), depth=2,
       crosslinks=["pow_known", "law_written"]),
    _q("mem_holiday", "memory",
       "What day does everybody stop work for, and what is it for?",
       "A shared day gives you a scene where your whole cast is in one place "
       "with something expected of them.",
       ("culture", "customs"),
       crosslinks=["rel_practice", "eco_work"]),
    _q("mem_shame", "memory",
       "What does this place not talk about?",
       "The thing nobody mentions is the thing a reader most wants explained, "
       "and it makes every polite conversation tense.",
       ("culture", "values"),
       crosslinks=["war_scars", "law_worst_crime"]),
    _q("mem_keepers", "memory",
       "Who is responsible for remembering, and are they believed?",
       "Whoever keeps the record decides what the past was, which is one of "
       "the quietest kinds of power a world can hold.",
       ("faction", "goals"),
       crosslinks=["rel_priest", "gov_power"]),
    _q("mem_object", "memory",
       "Is there an object that proves something about the past?",
       "A thing that settles an argument about history is worth killing for, "
       "and it puts an abstract question into somebody's hands.",
       ("object", "significance"),
       crosslinks=["pow_object", "law_proof"]),
)


# WHERE EACH QUESTION SITS IN THE CORPUS, which is a real ordering rather than
# an accident: each domain is written with its most foundational question first,
# so "who actually holds power here" comes before "who is in charge of a
# village". Anything that needs a tiebreak uses this instead of sorting by id,
# which would ask about borders before power because b sorts before p.
_ORDER: dict[str, int] = {q.id: i for i, q in enumerate(WORLD_RULES)}


def corpus_order(question_id: str) -> int:
    return _ORDER.get(question_id, len(_ORDER))


def answered_domains(threads: list[dict]) -> set[str]:
    """
    The parts of the world this writer has already decided something in.

    Used for ORDER, not for gating. A writer who has just said how power is
    held should be shown what that opened -- otherwise the promise the root
    system makes ("every answer opens the questions it implies") is invisible,
    and the walk reads as a fixed list that never reacts to anything.
    """
    shared = _shared_landings()
    return {q.domain for q in WORLD_RULES if _is_answered(threads, q, shared)}


def by_id(question_id: str) -> Question | None:
    for question in WORLD_RULES:
        if question.id == question_id:
            return question
    return None


# ── Which of them are still open ─────────────────────────────────────────────

def _has_content(threads: list[dict], type_id: str, section_id: str) -> bool:
    """
    Does any Thread of this type have prose in this section?

    Deliberately generous. One Thread with something written in it counts as
    the question answered: the writer has taken a position, and asking again
    because a SECOND government has an empty succession field would be
    pedantry rather than help.
    """
    for thread in threads:
        if thread.get("type") != type_id:
            continue
        section = (thread.get("sections") or {}).get(section_id) or {}
        if str(section.get("content") or "").strip():
            return True
        if section.get("trait_blocks"):
            return True
    return False


def _shared_landings() -> set[tuple[str, str]]:
    """
    The landing places more than one question lands in.

    There are about fifty places an answer can go and a hundred questions to
    ask, so sharing is not a mistake to be designed away -- eleven questions
    land in a lore entry's "rule or concept" because that is genuinely where a
    rule about the world belongs.
    """
    seen: dict[tuple[str, str], int] = {}
    for question in WORLD_RULES:
        seen[question.lands_as] = seen.get(question.lands_as, 0) + 1
    return {place for place, n in seen.items() if n > 1}


def _is_answered(threads: list[dict], question: "Question",
                 shared: set[tuple[str, str]]) -> bool:
    """
    Has this world answered THIS question?

    Two ways, because there are two ways a writer answers one.

    Through the walk, the entry that gets created or added to records the
    question id (`answers:` in its frontmatter), so the answer knows what it
    answers. That is the reliable way and the only one that can tell eleven
    questions sharing a landing place apart.

    By hand, an entry cannot know about question ids -- nobody types
    `answers: gov_succession` into a Markdown file. So where a question is the
    ONLY one that lands in its place, content there still counts on its own,
    exactly as generously as before. A writer who fills in a government's
    Succession section has plainly answered how succession works, and asking
    them again would be the app failing to read what is in front of it.

    Where the landing place is shared, content alone proves nothing about
    WHICH question it settles, so the entry has to say. The walk offers that as
    "the answer is already in one of these" -- one click, and the entry it
    points at gains the claim.
    """
    for thread in threads:
        if thread.get("type") != question.lands_as[0]:
            continue
        if question.id in (thread.get("answers") or []):
            return True
    if question.lands_as in shared:
        return False
    return _has_content(threads, question.lands_as[0], question.lands_as[1])


@dataclass
class OpenQuestion:
    question: Question
    # The answered questions that opened this one -- shown as "you said X,
    # which raises this". A question arriving with no reason behind it is the
    # thing that makes worldbuilding prompts feel like homework.
    because: list[str] = field(default_factory=list)
    # Answered crosslinks, for "this also touches your laws".
    touches: list[str] = field(default_factory=list)


def open_questions(threads: list[dict], *, max_depth: int = 2,
                   domains: list[str] | None = None) -> list[OpenQuestion]:
    """
    The questions this world has not answered yet, in a sensible order.

    Trunk questions come first and unconditionally. A child appears only once
    its parent is answered -- "what stops every heir being murdered" makes no
    sense before the writer has said how succession works, and asking it
    anyway is how a tool teaches somebody to ignore it.

    Crosslinks never gate anything. A world is a web, and two questions that
    each imply the other would deadlock a tree.
    """
    shared = _shared_landings()
    answered = {q.id: _is_answered(threads, q, shared) for q in WORLD_RULES}
    # Which answered questions unlock what, so a child can say why it is here.
    opened_by: dict[str, list[str]] = {}
    for question in WORLD_RULES:
        if not answered.get(question.id):
            continue
        for child in question.unlocks:
            opened_by.setdefault(child, []).append(question.prompt)

    out: list[OpenQuestion] = []
    for question in WORLD_RULES:
        if answered.get(question.id):
            continue
        if question.depth > max_depth:
            continue
        if domains and question.domain not in domains:
            continue
        if question.depth > 1 and not opened_by.get(question.id):
            continue                     # its parent has not been answered
        out.append(OpenQuestion(
            question=question,
            because=opened_by.get(question.id, []),
            touches=[by_id(c).prompt for c in question.crosslinks
                     if answered.get(c) and by_id(c)],
        ))
    return out
