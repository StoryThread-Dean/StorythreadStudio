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
# A question is answered when the place its answer lands has something in it.
# Nothing marks a question done. Same rule as every other stop: the condition
# ends, so the stop ends. A writer who deletes that section gets the question
# back, which is correct -- they no longer have an answer.

from dataclasses import dataclass, field

__all__ = [
    "DOMAINS", "WORLD_RULES", "Question", "by_id", "open_questions",
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
       unlocks=["pow_cost", "pow_who"]),
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
)


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
    answered = {
        q.id: _has_content(threads, q.lands_as[0], q.lands_as[1])
        for q in WORLD_RULES
    }
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
