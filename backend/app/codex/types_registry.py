# codex/types_registry.py -- what KINDS of thing a world contains
# ================================================================
# Today the app has four hardcoded entry types (character, relationship,
# location, lore), listed in Python in profiles.py and again in TypeScript in
# types/profile.ts. Adding "faction" means editing both and hoping they stay
# in step.
#
# The Weave makes that data instead: codex/types.json. Types, their sections,
# their custom fields, and the vocabulary of connections between them all
# live in one file, seeded from the defaults below and served to the frontend
# so the two cannot drift.
#
# ---------------------------------------------------------------------------
# WHY THIS FILE IS VALIDATED SO STRICTLY
# ---------------------------------------------------------------------------
# The moment a writer adds a custom type or a relation of their own, this
# stops being config and becomes THEIR DATA -- as much theirs as a chapter.
# So the recovery rule is the opposite of structure.json's:
#
#   structure.json corrupt  -> treat as absent, synthesize, carry on. It is
#                              derivable from the folder, so nothing is lost.
#   types.json corrupt      -> REFUSE. Report the error, leave the file
#                              exactly as it is, open the Weave read-only.
#
# "Helpfully" regenerating defaults over a writer's customization would
# destroy work that cannot be recovered from anywhere else. A validation
# error the writer can read and fix is always better than a silent reset.

import json
import os
import re

from app.codex.icon_keywords import icon_for_name

SCHEMA_VERSION = 1

# Identifiers are used as folder names, YAML keys and JSON keys, so they are
# kept boring on purpose: lowercase, no spaces, no punctuation beyond "_".
IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

# What a custom field may be. Deliberately short -- every kind here has an
# obvious editor and an obvious serialization.
FIELD_KINDS = {"text", "longtext", "number", "date", "boolean", "list"}

CARDINALITIES = {"one", "many"}

# Where a kind of Thread appears in the sidebar.
#
# Three groups, and ALL THREE ARE ALWAYS SHOWN even when empty. They are the
# navigational skeleton: a writer opening the Weave sees Notes, Profiles and
# Other, and moves toward whichever matches what they are thinking about.
# Hiding a group until it has content would mean they never discover it, and
# would leave nowhere to click "+ Add New" for the things that belong there.
#
# It is the SECTIONS INSIDE the groups that grow. That is where the
# anti-overwhelm rule applies -- see codex/sections.py.
#
# "Other" is not a dumping ground. It is the honest answer for a kind that
# is neither a written document nor a profile of something, and a writer can
# move a section out of it whenever they disagree.
GROUPS = {"notes", "profiles", "other"}
DEFAULT_GROUP = "other"

# Accepted on read only. An early build wrote "etc"; the word on screen is
# "Other", and a cryptic abbreviation in the writer's own types.json is not
# something to leave lying around.
_GROUP_ALIASES = {"etc": "other"}


def normalize_group(value) -> str:
    """A stored group name, mapped to what this build calls it."""
    group = str(value or DEFAULT_GROUP).strip().lower()
    return _GROUP_ALIASES.get(group, group)


class TypesError(Exception):
    """An invalid registry. Carries where the problem is, so the message can
    point at a line rather than saying 'invalid file'."""

    def __init__(self, message: str, path: str = ""):
        self.path = path
        super().__init__(f"{path}: {message}" if path else message)


# ── The built-in defaults ────────────────────────────────────────────────────
# Seeded into a new project's types.json. After that the file is the writer's;
# these are never re-applied over it.

# HEADING CASE. `.title()` alone gives "Rule Or Concept" and "Tone And
# Atmosphere", which is not how English writes a heading -- and worse, it is not
# what the Profile Builder writes, so the same section came out named two
# different ways depending on which screen created the entry. The id is derived
# from the heading by squashing case and punctuation, so fixing the words
# changes nothing about where anything is filed.
_SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on",
                "or", "the", "to", "with"}


def _heading(name: str) -> str:
    words = name.replace("_", " ").split()
    return " ".join(
        word.capitalize() if i == 0 or word not in _SMALL_WORDS else word
        for i, word in enumerate(words)
    )


def _sections(*names: str) -> list[dict]:
    return [{"id": n, "heading": _heading(n), "trait_blocks": False}
            for n in names]


# THE SIDEBAR RULE, in one place because three surfaces depend on it:
#
#   A section appears when it holds something, OR when it is a default.
#
# Defaults are the handful a writer of any book will use -- Characters,
# Locations, Lore -- so a new project is not an empty tree with nothing to
# click. Everything else stays out of the way until it has a reason to be
# there, which is what stops a nine-kind world from greeting a beginner with
# nine empty headings.
#
# The same rule handles the awkward case gracefully: an existing project
# already has an Outline and a Style Guide, so those sections keep showing
# exactly as they always did. Nothing has to know whether a project is old
# or new.


DEFAULT_TYPES: list[dict] = [
    {
        "id": "character", "label": "Characters", "folder": "characters",
        "icon": "User",
        "sections": [
            {"id": "overview", "heading": "Overview", "trait_blocks": False},
            {"id": "physical_traits", "heading": "Physical Traits", "trait_blocks": True},
            {"id": "personality_traits", "heading": "Personality Traits", "trait_blocks": True},
            {"id": "motivations", "heading": "Motivations", "trait_blocks": True},
            {"id": "voice_notes", "heading": "Voice Notes", "trait_blocks": True},
            {"id": "hidden_and_foreshadowing_traits",
             "heading": "Hidden and Foreshadowing Traits", "trait_blocks": True},
            {"id": "relationships_overview", "heading": "Relationships Overview",
             "trait_blocks": False},
            {"id": "notes", "heading": "Notes", "trait_blocks": False},
        ],
        "required_fields": ["overview"],
        "custom_fields": [],
        "group": "profiles",
        "default_section": True,
    },
    # THE PROFILE BUILDER'S SETS ARE CANONICAL, and these used to be shorter.
    #
    # Two populations of the same kind were ending up with different sections:
    # an entry converted from profiles/ carried the Profile Builder's headings,
    # while one created by Weaving was seeded from the four words below -- so a
    # writer had Locations with "Physical Description" and Locations with
    # "Appearance", and only one of them showed up in the editor.
    #
    # The Profile Builder's sets win because they are what the writer has
    # actually been filling in. Deciding the other way would have meant asking
    # them to accept a thinner page for the same job.
    {"id": "relationship", "label": "Relationships", "folder": "relationships",
     "icon": "Heart", "group": "profiles", "default_section": False,
     "sections": _sections("overview", "history", "current_dynamic",
                           "hidden_tensions", "emotional_direction", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "location", "label": "Locations", "folder": "locations", "icon": "MapPin",
     "group": "profiles", "default_section": True,
     "sections": _sections("overview", "physical_description",
                           "tone_and_atmosphere", "historical_significance",
                           "cultural_significance", "scene_use_notes", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "lore", "label": "Lore", "folder": "lore", "icon": "BookOpen",
     "group": "profiles", "default_section": True,
     "sections": _sections("overview", "rule_or_concept", "what_it_affects",
                           "what_characters_know", "story_relevance", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    # ── Profiles: an entry ABOUT something in the world ──────────────────
    # A person, a place, a group, a faith, a government. The test is "am I
    # writing a profile OF something?" -- which is why a Faction belongs
    # here beside a Character, and not in the leftovers.
    {"id": "faction", "label": "Factions", "folder": "factions", "icon": "Flag",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "structure", "goals", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "religion", "label": "Religions", "folder": "religions", "icon": "Sparkles",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "beliefs", "practices", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "government", "label": "Governments", "folder": "governments", "icon": "Landmark",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "structure", "laws", "succession", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "deity", "label": "Deities", "folder": "deities", "icon": "Sun",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "domain", "worship", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "creature", "label": "Creatures", "folder": "creatures", "icon": "PawPrint",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "appearance", "behaviour", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "culture", "label": "Cultures", "folder": "cultures", "icon": "Drama",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "customs", "values", "notes"),
     "required_fields": ["overview"], "custom_fields": []},

    # ── Other: genuinely neither a document nor a profile of something ───
    {"id": "object", "label": "Objects", "folder": "objects", "icon": "Package",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "appearance", "significance", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "concept", "label": "Concepts", "folder": "concepts", "icon": "Lightbulb",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "details", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    # Event is Other's default, so that group opens with something familiar
    # in it rather than as a bare heading. Of the four it is the one a writer
    # of any book recognises without explanation -- a battle, a wedding, a
    # coronation -- which makes it the right doorway into a group whose name
    # gives nothing away.
    {"id": "event", "label": "Events", "folder": "events", "icon": "CalendarClock",
     "group": "other", "default_section": True,
     "sections": _sections("overview", "what_happened", "consequences", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "language", "label": "Languages", "folder": "languages", "icon": "Languages",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "sound_and_script", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
]


# ── WHO ASKS, AND WHO ONLY GETS ASKED ABOUT ──────────────────────────────────
#
# Only a kind with AGENCY is ever the subject of "how is X connected to the
# story?". Reported from live use, with the example that settled it: Croft
# Manor is a location, and its way into the story is THROUGH Lara -- she
# inherited it, lives in it, left it. "A location wouldn't know anyone or have
# anything to do with someone." The same holds for lore, factions, deities,
# governments, religions and cultures: things connect TO them, they do not go
# looking. So the connection walk flags characters and creatures, and a
# passive thing becomes connected the moment someone active is tied to it.
#
# This gates the WALK only. A writer can still open any entry -- a location,
# a faction -- and record a connection from it by hand; nothing passive is
# locked out, it just is not nagged.
#
# Data first, like everything else here: a type entry in the writer's own
# types.json may carry `"active": true` (a sentient ship, a talking sword) or
# `"active": false`, and that word wins. Absent the word, only these two ask.
ACTIVE_TYPES = frozenset({"character", "creature"})


def is_active(registry: dict, type_id: str) -> bool:
    """Does this kind get flagged to connect, or only get connected to?"""
    for entry in registry.get("types") or []:
        if entry.get("id") == type_id:
            if "active" in entry:
                return bool(entry.get("active"))
            break
    return type_id in ACTIVE_TYPES


# The headings a writer picks a relation UNDER, in the order they are offered.
#
# A flat list of sixty relations is a worse question than no list at all -- the
# writer reads all of it to find one item. Under a heading they read one heading
# and four items. So every relation names a group, and the editor renders the
# picker as one dropdown with these as its sections.
#
# The first three names came from the writer, with their own examples in them.
# The rest exist because their list, extended, kept producing things that were
# plainly neither family nor friendship nor romance.
GROUP_FAMILY = "Family"
GROUP_KNOWS = "Knows / Known"
GROUP_INTIMATE = "Intimate"
GROUP_AGAINST = "Against"
GROUP_DUTY = "Duty and standing"
GROUP_BELONGING = "Belonging"
GROUP_PLACE = "Place"
GROUP_BELIEF = "Belief"
GROUP_THINGS = "Things and events"
GROUP_OTHER = "Other"

RELATION_GROUPS = [
    GROUP_FAMILY, GROUP_KNOWS, GROUP_INTIMATE, GROUP_AGAINST, GROUP_DUTY,
    GROUP_BELONGING, GROUP_PLACE, GROUP_BELIEF, GROUP_THINGS, GROUP_OTHER,
]


def _rel(rid, label, *, inverse=None, symmetric=False, src, dst,
         cardinality="many", exclusive_group=None, universal=False,
         group=GROUP_OTHER) -> dict:
    entry = {
        "id": rid, "label": label, "inverse": inverse, "symmetric": symmetric,
        "source_types": list(src), "target_types": list(dst),
        "cardinality": cardinality, "exclusive_group": exclusive_group,
        # Which heading the picker files it under. Data, like everything else in
        # this file, so a writer's own relation can join a group.
        "group": group,
    }
    if universal:
        # Runs between ANY two kinds, including ones the writer invents later.
        # Only written when true, so an ordinary relation's record is unchanged.
        entry["universal"] = True
    return entry


# NOTE on exclusive_group, which is deliberately EMPTY on married_to.
# It is tempting to have the contradiction checker treat two simultaneous
# marriages as an error. That would encode one culture's marriage rules into
# a tool for writing invented ones -- polygamy, political marriages and
# stranger arrangements are ordinary in fiction. Exclusivity is something a
# writer declares about THEIR world, not something the app assumes.
DEFAULT_RELATIONS: list[dict] = [
    # ── The plain one, and the one most writers want most of the time ────────
    #
    # A CONNECTION IS ALLOWED TO BE UNTYPED. Requiring a relation before two
    # things can be joined gets the order of work wrong: a writer knows that
    # Drizzt and Guenhwyvar belong together long before they want to argue with
    # themselves about whether that is a bond, a friendship or ownership. Made
    # to choose in that moment they will either pick badly or stop.
    #
    # So this exists, it is offered first, and it means exactly what it says.
    # Saying more about it later is an improvement to a connection that already
    # exists, not a precondition for making one.
    #
    # `universal` is the one place a relation escapes the type check, and it is
    # data rather than code: the flag lives in types.json like everything else,
    # so a writer's own relation can be universal too. It has to be, because a
    # kind invented tomorrow could not be listed in a file written today.
    _rel("connected_to", "connected to", symmetric=True, universal=True,
         src=["character", "location"], dst=["character", "location"]),

    _rel("mentored_by", "mentored by", inverse="mentor_of",
         src=["character"], dst=["character"], group=GROUP_KNOWS),
    _rel("parent_of", "parent of", inverse="child_of",
         src=["character"], dst=["character"], group=GROUP_FAMILY),
    _rel("sibling_of", "sibling of", symmetric=True,
         src=["character"], dst=["character"], group=GROUP_FAMILY),
    _rel("married_to", "married to", symmetric=True,
         src=["character"], dst=["character"], group=GROUP_INTIMATE),
    _rel("loves", "loves", src=["character"], dst=["character"],
         group=GROUP_INTIMATE),
    _rel("rivals", "rival of", symmetric=True,
         src=["character"], dst=["character"], group=GROUP_AGAINST),
    _rel("betrayed", "betrayed", inverse="betrayed_by",
         src=["character"], dst=["character"], group=GROUP_AGAINST),
    _rel("serves", "serves", inverse="served_by",
         src=["character"], dst=["character", "faction"],
         group=GROUP_DUTY),
    _rel("member_of", "member of", inverse="has_member", group=GROUP_BELONGING,
         src=["character"], dst=["faction", "religion"]),
    _rel("leads", "leads", inverse="led_by", group=GROUP_DUTY,
         src=["character"], dst=["faction", "religion"], cardinality="one"),
    _rel("founded", "founded", inverse="founded_by", group=GROUP_BELONGING,
         src=["character"], dst=["faction", "religion", "location"]),
    _rel("exiled_from", "exiled from", group=GROUP_BELONGING,
         src=["character"], dst=["location", "faction"]),
    _rel("born_in", "born in", src=["character"], dst=["location"],
         cardinality="one", group=GROUP_PLACE),
    _rel("rules", "rules", inverse="ruled_by", group=GROUP_DUTY,
         src=["character", "faction"], dst=["location"]),
    _rel("at_war_with", "at war with", symmetric=True, group=GROUP_AGAINST,
         src=["faction", "religion"], dst=["faction", "religion"]),
    _rel("allied_with", "allied with", symmetric=True, group=GROUP_BELONGING,
         src=["faction", "religion"], dst=["faction", "religion"]),
    _rel("vassal_of", "vassal of", inverse="overlord_of", group=GROUP_DUTY,
         src=["faction"], dst=["faction"], cardinality="one"),
    _rel("schism_of", "schism of", group=GROUP_BELONGING,
         src=["faction", "religion"],
         dst=["faction", "religion"]),
    _rel("believes", "believes", group=GROUP_BELIEF,
         src=["character", "faction"],
         dst=["religion", "lore", "concept"]),
    _rel("practices", "practices", group=GROUP_BELIEF,
         src=["character", "faction"],
         dst=["religion", "concept"]),
    _rel("forbidden_by", "forbidden by", group=GROUP_BELIEF,
         src=["concept", "object", "lore"],
         dst=["religion", "faction"]),
    _rel("prophesied_in", "prophesied in", group=GROUP_BELIEF,
         src=["character", "event"],
         dst=["lore", "religion"]),
    # A manor is ownable. The original list stopped at objects, and the first
    # real estate a writer reached for (Croft Manor) had no way to be hers.
    _rel("owns", "owns", inverse="owned_by", group=GROUP_THINGS,
         src=["character", "faction"], dst=["object", "location"]),

    # The kinds beyond characters and factions had almost no vocabulary, which
    # showed up the moment a real world needed it: a faction that worships a
    # deity, a religion named after that deity, and the deity itself were three
    # entries with no way to say how they relate. Each of these exists because
    # a writer could not express something without it.
    _rel("worships", "worships", inverse="worshipped_by", group=GROUP_BELIEF,
         src=["character", "faction", "culture", "religion"],
         dst=["deity", "religion"]),
    _rel("part_of", "part of", inverse="contains", group=GROUP_BELONGING,
         src=["faction", "religion", "government", "culture"],
         dst=["faction", "religion", "government", "culture"]),
    _rel("governs", "governs", inverse="governed_by", group=GROUP_DUTY,
         src=["government", "faction"], dst=["location"]),
    _rel("sacred_to", "sacred to", group=GROUP_BELIEF,
         src=["location", "object", "creature"], dst=["religion", "deity"]),
    _rel("native_to", "native to", group=GROUP_PLACE,
         src=["creature", "culture"], dst=["location"]),
    _rel("occurred_at", "happened at", group=GROUP_THINGS,
         src=["event"], dst=["location"], cardinality="one"),
    _rel("involved", "involved", inverse="involved_in", group=GROUP_THINGS,
         src=["event"], dst=["character", "faction", "religion", "government"]),

    # Checked against a real, densely connected character (Drizzt Do'Urden) and
    # every one of these was a thing the writer could not say. Creatures had no
    # vocabulary at all, so a ranger and his panther were two entries with
    # nothing between them.
    #
    # companion_of covers two gaps with one relation on purpose. A companion is
    # a companion whether they are a person or an animal, and splitting it into
    # "friend of" and "bonded to" would ask the writer to classify a bond the
    # story does not classify.
    #
    # NOT derived from the faction called "Companions of the Hall". That is a
    # proper noun, and the words inside a proper noun mean nothing about how its
    # members relate -- the Hand and the Foot in Ninja Turtles are not body
    # parts. Reading a relation out of a name is exactly the assumption this
    # feature exists to avoid making.
    _rel("companion_of", "companion of", symmetric=True, group=GROUP_KNOWS,
         src=["character", "creature"], dst=["character", "creature"]),
    _rel("lives_in", "lives in", inverse="home_of", group=GROUP_PLACE,
         src=["character", "creature", "culture", "faction"], dst=["location"]),

    # ── How someone relates to a PLACE ───────────────────────────────────────
    #
    # From live use, with the writer's own list: "Person A is going to, living
    # in, residing at, currently staying at, passed thru, doesn't know the
    # existance of" a location. Before these, a stop about a place offered a
    # dropdown where "logically none of the entries make sense" -- the place
    # vocabulary was three words. Every one of these reads in the sentence the
    # editor shows, active end first: "Lara Croft inherited Croft Manor".
    #
    # "Currently" and "formerly" are moments, and moments are what anchors are
    # for -- but a writer says "formerly lived in" long before they reach for a
    # chapter number, so the plain words exist too.
    _rel("staying_at", "staying at", inverse="hosting", group=GROUP_PLACE,
         src=["character", "creature"], dst=["location"]),
    _rel("formerly_lived_in", "formerly lived in", group=GROUP_PLACE,
         src=["character", "creature", "culture", "faction"], dst=["location"]),
    _rel("passed_through", "passed through", group=GROUP_PLACE,
         src=["character", "creature", "faction"], dst=["location"]),
    _rel("travelling_to", "travelling to", group=GROUP_PLACE,
         src=["character", "creature", "faction"], dst=["location"]),

    # The Croft Manor case itself: she has it because her father died. An
    # inheritance can be a house, a sword, or a company, so the targets are
    # wide on purpose.
    _rel("inherited", "inherited", inverse="inherited_by", group=GROUP_THINGS,
         src=["character"], dst=["location", "object", "faction"]),

    # Not knowing is a relationship too -- the writer's example was a place
    # whose existence a character is unaware of, which is often the plot.
    _rel("unaware_of", "does not know the existence of", group=GROUP_KNOWS,
         src=["character", "creature", "faction"],
         dst=["location", "object", "character", "faction", "lore"]),

    # ── The rest of what a writer actually needs to say ─────────────────────
    #
    # Asked for as "the list can be larger and more extensive now. Covering the
    # bases of most relationships." Each one below is a relationship a novel
    # ordinarily contains and the app previously had no words for -- a childhood
    # rivalry, an ex, a debt, a cousin.
    #
    # Every label is written to read correctly in the sentence the editor shows,
    # "A <label> B", because that sentence is what the writer is agreeing to.
    # Where a relation is not symmetric it names its inverse, so the other end
    # reads right by default without the writer answering twice.
    #
    # Kept to relationships, not to grades of one relationship: "friend of" and
    # "close friend of" is a distinction worth having; five degrees of friendship
    # would push the work of choosing back onto the writer, which is the problem
    # a grouped list exists to solve.

    # Family
    _rel("child_of", "child of", inverse="parent_of", group=GROUP_FAMILY,
         src=["character"], dst=["character"]),
    _rel("cousin_of", "cousin of", symmetric=True, group=GROUP_FAMILY,
         src=["character"], dst=["character"]),
    _rel("half_sibling_of", "half-sibling of", symmetric=True,
         group=GROUP_FAMILY, src=["character"], dst=["character"]),
    _rel("grandparent_of", "grandparent of", inverse="grandchild_of",
         group=GROUP_FAMILY, src=["character"], dst=["character"]),
    _rel("adopted_by", "adopted by", inverse="adoptive_parent_of",
         group=GROUP_FAMILY, src=["character"], dst=["character"]),
    _rel("raised_by", "raised by", inverse="raised", group=GROUP_FAMILY,
         src=["character"], dst=["character"]),
    _rel("guardian_of", "guardian of", inverse="ward_of", group=GROUP_FAMILY,
         src=["character"], dst=["character"]),
    _rel("in_law_of", "in-law of", symmetric=True, group=GROUP_FAMILY,
         src=["character"], dst=["character"]),
    _rel("ancestor_of", "ancestor of", inverse="descendant_of",
         group=GROUP_FAMILY, src=["character"], dst=["character"]),

    # Knows / Known
    _rel("acquaintance_of", "acquaintance of", symmetric=True, group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("friend_of", "friend of", symmetric=True, group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("close_friend_of", "close friend of", symmetric=True,
         group=GROUP_KNOWS, src=["character"], dst=["character"]),
    _rel("childhood_friend_of", "childhood friend of", symmetric=True,
         group=GROUP_KNOWS, src=["character"], dst=["character"]),
    _rel("confidant_of", "confidant of", group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("partners_with", "partners with", symmetric=True, group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("colleague_of", "colleague of", symmetric=True, group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("neighbour_of", "neighbour of", symmetric=True, group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("student_of", "student of", inverse="teacher_of", group=GROUP_KNOWS,
         src=["character"], dst=["character"]),
    _rel("knows_of", "knows of", group=GROUP_KNOWS,
         src=["character"], dst=["character"]),

    # Intimate
    _rel("engaged_to", "engaged to", symmetric=True, group=GROUP_INTIMATE,
         src=["character"], dst=["character"]),
    _rel("lover_of", "lover of", symmetric=True, group=GROUP_INTIMATE,
         src=["character"], dst=["character"]),
    _rel("ex_lover_of", "ex-lover of", symmetric=True, group=GROUP_INTIMATE,
         src=["character"], dst=["character"]),
    _rel("courting", "courting", inverse="courted_by", group=GROUP_INTIMATE,
         src=["character"], dst=["character"]),
    _rel("friends_with_benefits_with", "friends with benefits with",
         symmetric=True, group=GROUP_INTIMATE,
         src=["character"], dst=["character"]),
    _rel("divorced_from", "divorced from", symmetric=True,
         group=GROUP_INTIMATE, src=["character"], dst=["character"]),
    _rel("widowed_by", "widowed by", group=GROUP_INTIMATE,
         src=["character"], dst=["character"]),
    _rel("unrequited_love_for", "in unrequited love with",
         group=GROUP_INTIMATE, src=["character"], dst=["character"]),

    # Against
    _rel("enemy_of", "enemy of", symmetric=True, group=GROUP_AGAINST,
         src=["character"], dst=["character"]),
    _rel("childhood_rival_of", "childhood rival of", symmetric=True,
         group=GROUP_AGAINST, src=["character"], dst=["character"]),
    _rel("frenemy_of", "frenemy of", symmetric=True, group=GROUP_AGAINST,
         src=["character"], dst=["character"]),
    _rel("feuding_with", "feuding with", symmetric=True, group=GROUP_AGAINST,
         src=["character", "faction"], dst=["character", "faction"]),
    _rel("hunting", "hunting", inverse="hunted_by", group=GROUP_AGAINST,
         src=["character", "creature", "faction"],
         dst=["character", "creature", "faction"]),
    _rel("sworn_to_destroy", "sworn to destroy", group=GROUP_AGAINST,
         src=["character", "faction"],
         dst=["character", "faction", "religion", "location"]),
    _rel("distrusts", "distrusts", group=GROUP_AGAINST,
         src=["character"], dst=["character", "faction"]),

    # Duty and standing
    _rel("commands", "commands", inverse="commanded_by", group=GROUP_DUTY,
         src=["character"], dst=["character", "faction"]),
    _rel("employed_by", "employed by", inverse="employs", group=GROUP_DUTY,
         src=["character"], dst=["character", "faction"]),
    _rel("sworn_to", "sworn to", group=GROUP_DUTY,
         src=["character"], dst=["character", "faction", "religion"]),
    _rel("owes_a_debt_to", "owes a debt to", group=GROUP_DUTY,
         src=["character", "faction"], dst=["character", "faction"]),
    _rel("protects", "protects", inverse="protected_by", group=GROUP_DUTY,
         src=["character", "faction"], dst=["character", "location", "object"]),
    _rel("answers_to", "answers to", inverse="answered_to_by",
         group=GROUP_DUTY, src=["character", "faction"],
         dst=["character", "faction", "government"]),
    _rel("summons", "summons", inverse="summoned_by",
         src=["object", "concept", "lore"], dst=["creature", "deity"]),
]


def default_registry() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "types": [dict(t) for t in DEFAULT_TYPES],
        "relations": [dict(r) for r in DEFAULT_RELATIONS],
    }


# ── Validation ───────────────────────────────────────────────────────────────

def _check_identifier(value, path: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.match(value):
        raise TypesError(
            f"{value!r} is not a valid id. Use lowercase letters, digits and "
            f"underscores, starting with a letter (max 40 characters).",
            path,
        )
    return value


def validate_registry(data) -> None:
    """
    Raise TypesError describing the FIRST problem found, naming its location.

    Deliberately fail-fast with a located message: "types[3].id" tells a
    writer where to look, where "invalid types.json" does not.
    """
    if not isinstance(data, dict):
        raise TypesError("The file must contain a JSON object.")

    version = data.get("schema_version")
    if version is None:
        raise TypesError("Missing 'schema_version'.", "schema_version")
    if not isinstance(version, int):
        raise TypesError("Must be a whole number.", "schema_version")
    if version > SCHEMA_VERSION:
        # Written by a newer build. Refusing beats guessing at a shape we do
        # not know -- and beats silently discarding whatever is new in it.
        raise TypesError(
            f"This file was written by a newer version of Storythread Studio "
            f"(schema {version}; this build understands {SCHEMA_VERSION}). "
            f"Update the app to open it.",
            "schema_version",
        )

    types = data.get("types")
    if not isinstance(types, list) or not types:
        raise TypesError("At least one type is required.", "types")

    seen_types: set[str] = set()
    seen_folders: set[str] = set()
    for i, entry in enumerate(types):
        path = f"types[{i}]"
        if not isinstance(entry, dict):
            raise TypesError("Must be an object.", path)
        type_id = _check_identifier(entry.get("id"), f"{path}.id")
        if type_id in seen_types:
            raise TypesError(f"Duplicate type id {type_id!r}.", f"{path}.id")
        seen_types.add(type_id)

        folder = entry.get("folder")
        if not isinstance(folder, str) or not folder.strip():
            raise TypesError("A folder name is required.", f"{path}.folder")
        # Two types sharing a folder would silently interleave their entries.
        if folder in seen_folders:
            raise TypesError(f"Duplicate folder {folder!r}.", f"{path}.folder")
        seen_folders.add(folder)
        if "/" in folder or "\\" in folder or ".." in folder:
            raise TypesError("Must be a plain folder name.", f"{path}.folder")

        group = normalize_group(entry.get("group", DEFAULT_GROUP))
        if group not in GROUPS:
            raise TypesError(
                f"{group!r} is not a sidebar group. Use one of: "
                f"{', '.join(sorted(GROUPS))}.",
                f"{path}.group",
            )

        sections = entry.get("sections")
        if not isinstance(sections, list) or not sections:
            raise TypesError("At least one section is required.", f"{path}.sections")
        seen_sections: set[str] = set()
        for j, section in enumerate(sections):
            spath = f"{path}.sections[{j}]"
            if not isinstance(section, dict):
                raise TypesError("Must be an object.", spath)
            section_id = _check_identifier(section.get("id"), f"{spath}.id")
            if section_id in seen_sections:
                raise TypesError(f"Duplicate section id {section_id!r}.", f"{spath}.id")
            seen_sections.add(section_id)

        for j, field in enumerate(entry.get("custom_fields") or []):
            fpath = f"{path}.custom_fields[{j}]"
            if not isinstance(field, dict):
                raise TypesError("Must be an object.", fpath)
            _check_identifier(field.get("id"), f"{fpath}.id")
            kind = field.get("kind")
            if kind not in FIELD_KINDS:
                raise TypesError(
                    f"{kind!r} is not a field kind. Use one of: "
                    f"{', '.join(sorted(FIELD_KINDS))}.",
                    f"{fpath}.kind",
                )

        for name in entry.get("required_fields") or []:
            if name not in seen_sections and name not in {
                f.get("id") for f in (entry.get("custom_fields") or [])
            }:
                raise TypesError(
                    f"{name!r} is required but is neither a section nor a custom field.",
                    f"{path}.required_fields",
                )

    relations = data.get("relations")
    if not isinstance(relations, list):
        raise TypesError("Must be a list (may be empty).", "relations")

    seen_relations: set[str] = set()
    for i, rel in enumerate(relations):
        path = f"relations[{i}]"
        if not isinstance(rel, dict):
            raise TypesError("Must be an object.", path)
        rel_id = _check_identifier(rel.get("id"), f"{path}.id")
        if rel_id in seen_relations:
            raise TypesError(f"Duplicate relation id {rel_id!r}.", f"{path}.id")
        seen_relations.add(rel_id)

        if rel.get("inverse") is not None:
            _check_identifier(rel.get("inverse"), f"{path}.inverse")
            if rel.get("symmetric"):
                # A symmetric relation IS its own inverse; naming another one
                # would give two different answers to the same question.
                raise TypesError(
                    "A symmetric relation cannot also name an inverse.",
                    f"{path}.inverse",
                )

        for key in ("source_types", "target_types"):
            values = rel.get(key)
            if not isinstance(values, list) or not values:
                raise TypesError("At least one type is required.", f"{path}.{key}")
            for value in values:
                if value not in seen_types:
                    raise TypesError(
                        f"{value!r} is not a type defined in this file.",
                        f"{path}.{key}",
                    )

        if rel.get("cardinality", "many") not in CARDINALITIES:
            raise TypesError(
                f"Must be one of: {', '.join(sorted(CARDINALITIES))}.",
                f"{path}.cardinality",
            )


# ── Loading ──────────────────────────────────────────────────────────────────

def registry_path(folder_path: str) -> str:
    return os.path.join(folder_path, "codex", "types.json")


def load_registry(folder_path: str) -> tuple[dict, bool]:
    """
    (registry, from_file). Raises TypesError on an invalid file.

    An ABSENT file yields the built-in defaults with from_file=False and
    writes nothing -- same lifecycle rule as structure.json, so a project
    that never opens the Weave stays untouched.

    An INVALID file raises. It is never replaced, never repaired, never
    quietly ignored: it is the writer's own data, and the caller's job is to
    surface the message and open read-only.
    """
    path = registry_path(folder_path)
    if not os.path.isfile(path):
        return default_registry(), False

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise TypesError(
            f"The file is not valid JSON (line {exc.lineno}, column {exc.colno}): "
            f"{exc.msg}. It has been left exactly as it is."
        ) from exc
    except OSError as exc:
        raise TypesError(f"The file could not be read: {exc}") from exc

    validate_registry(data)
    return data, True


def seed_registry(folder_path: str) -> dict:
    """
    Write the built-in registry if the project does not have one yet.

    Never overwrites: an existing file is the writer's, whatever state it is
    in. Returns whatever is now in force.
    """
    path = registry_path(folder_path)
    if os.path.isfile(path):
        return load_registry(folder_path)[0]

    registry = default_registry()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)
    os.replace(tmp, path)
    return registry


# ── Reading the registry ─────────────────────────────────────────────────────

# Names Windows refuses to use for a file or folder, whatever the extension.
# A writer naming a kind "Aux" is not doing anything wrong, and the failure
# would be baffling -- the folder simply cannot be created.
_WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}

# Letters and single spaces. Deliberately narrower than IDENTIFIER_RE, which
# governs ids the APP writes -- this one governs a name a writer types, and
# it becomes a folder on their disk.
_CUSTOM_NAME_RE = re.compile(r"^[A-Za-z]+(?: [A-Za-z]+)*$")
CUSTOM_NAME_MAX = 32


def pluralize(word: str) -> str:
    """
    A section heading names a container, so it reads as a plural.

    "Characters", not "Character" -- the writer should see at a glance that
    a section holds many. Enough English to cover what a writer will
    actually type: Deity -> Deities, Church -> Churches, Bloodline ->
    Bloodlines. Not a full pluralizer, and it does not need to be; the label
    is editable and nothing depends on it being grammatically perfect.
    """
    lower = word.lower()
    if lower.endswith("y") and len(word) > 1 and word[-2].lower() not in "aeiou":
        return word[:-1] + "ies"
    if lower.endswith(("s", "x", "z", "ch", "sh")):
        return word + "es"
    return word + "s"


def custom_type_id(label: str) -> tuple[str, str]:
    """
    Turn a name a writer typed into (type_id, tidy_label), or refuse.

    Narrow on purpose. This name becomes a FOLDER on the writer's disk, and
    the ways that goes wrong are all quiet: a digit or a symbol that some
    tool later chokes on, a trailing space Windows silently strips, a
    reserved device name that simply cannot be created. Better to say "use
    letters" up front than to fail at save time with something unreadable.

    Letters and single spaces only. "Royal Household" -> royal_household.
    """
    tidy = " ".join(str(label or "").split())
    if not tidy:
        raise TypesError("Give this kind a name.", "label")
    if len(tidy) > CUSTOM_NAME_MAX:
        raise TypesError(
            f"That name is too long. Keep it under {CUSTOM_NAME_MAX} characters.",
            "label",
        )
    if any(ch.isdigit() for ch in tidy):
        raise TypesError(
            "Use letters only -- no numbers. This name becomes a folder on "
            "your computer.",
            "label",
        )
    if not _CUSTOM_NAME_RE.match(tidy):
        raise TypesError(
            "Use letters and spaces only, with no punctuation or symbols. "
            "This name becomes a folder on your computer.",
            "label",
        )

    type_id = tidy.lower().replace(" ", "_")
    if type_id in _WINDOWS_RESERVED or type_id.split("_")[0] in _WINDOWS_RESERVED:
        raise TypesError(
            f"Windows will not allow a folder called {tidy!r}. Try another name.",
            "label",
        )
    return type_id, tidy.title()


def add_type(
    project_path: str,
    type_id: str,
    label: str,
    group: str = DEFAULT_GROUP,
    icon: str | None = None,
) -> dict:
    """
    Add a kind of Thread the Weave did not ship with -- a Government, a
    Deity, a Bloodline, a Ship.

    A custom kind behaves exactly like a built-in one: its own folder, its
    own section in the sidebar, its own entries and connections. Nothing
    about the rest of the system needs to know it was added later, which is
    the whole reason the registry is data.

    Writes to the project's own types.json, seeding it from the defaults
    first if the project has never had one.
    """
    # The name the writer typed is what governs, because it is what becomes a
    # folder. The id is derived from it rather than accepted separately, so
    # there is no way to slip a digit or a symbol past the rule.
    type_id, label = custom_type_id(label or type_id.replace("_", " "))
    group = normalize_group(group)
    if group not in GROUPS:
        raise TypesError(
            f"{group!r} is not a sidebar group. Use one of: {', '.join(sorted(GROUPS))}.",
            "group",
        )

    registry = seed_registry(project_path)
    if type_by_id(registry, type_id) is not None:
        raise TypesError(f"This world already has a kind called {type_id!r}.", "id")

    folder = pluralize(type_id)
    if any(t.get("folder") == folder for t in registry.get("types", [])):
        raise TypesError(f"The folder {folder!r} is already in use.", "folder")

    registry["types"].append({
        "id": type_id,
        # The heading names a container, so it reads as a plural like every
        # other section: a writer who types "Bloodline" gets "Bloodlines".
        "label": pluralize(label),
        "folder": folder,
        # A small surprise: if a word in the name is one the app recognises,
        # the section gets a fitting icon rather than the neutral fallback.
        # A miss looks exactly like it did before -- see codex/icon_keywords.
        "icon": icon or icon_for_name(label) or "CircleDashed",
        "group": group,
        # Same rule as every built-in kind: the section appears once it holds
        # something. Adding a kind is the first half of "choose Government,
        # write the first one, save" -- and a kind whose entry was never
        # saved should not leave an empty heading behind. It stays offered
        # under "+ Add New" until it has an entry, which also means an
        # abandoned attempt heals itself.
        "default_section": False,
        "sections": _sections("overview", "details", "notes"),
        "required_fields": ["overview"],
        "custom_fields": [],
    })

    validate_registry(registry)
    _write_registry(project_path, registry)
    return registry


def show_type(project_path: str, type_id: str) -> dict:
    """
    Start showing a kind that already exists but is not on screen.

    This is what "+ Add New > Faction" does. Faction is a kind the Weave
    ships with -- picking it is not CREATING anything, it is saying "I want
    this section in my sidebar". Routing that through add_type would refuse
    it as a duplicate, which is technically true and completely unhelpful.

    Setting default_section means "show even while empty", which is exactly
    what a writer who just asked for the section expects: it appears, and
    they can put the first entry in it.
    """
    registry = seed_registry(project_path)
    entry = type_by_id(registry, type_id)
    if entry is None:
        raise TypesError(f"This world has no kind called {type_id!r}.", "id")
    entry["default_section"] = True
    _write_registry(project_path, registry)
    return registry


def hide_type(project_path: str, type_id: str) -> dict:
    """
    Stop showing an empty section.

    The way back out. A writer who added Religion and never used it should
    be able to tidy it away without deleting anything -- and a section that
    HOLDS something is not hidden by this, because the rule is "appears when
    it holds something OR is a default" and only the second half is being
    turned off.
    """
    registry = seed_registry(project_path)
    entry = type_by_id(registry, type_id)
    if entry is None:
        raise TypesError(f"This world has no kind called {type_id!r}.", "id")
    entry["default_section"] = False
    _write_registry(project_path, registry)
    return registry


def count_entries(project_path: str, folder: str) -> int:
    """How many entries a kind's folder holds, in either layout."""
    total = 0
    for root in ("codex", "profiles"):
        path = os.path.join(project_path, root, folder)
        if os.path.isdir(path):
            try:
                total += sum(1 for n in os.listdir(path) if n.endswith(".md"))
            except OSError:
                pass
    return total


def rename_type(project_path: str, type_id: str, label: str) -> dict:
    """
    Fix a name. "Magic Sysstem" becomes "Magic System".

    A typo in a section name is permanent-feeling in a way it has no right to
    be, so this moves everything with it: the folder on disk, the `type:`
    line in every entry already written, and the registry itself. Nothing the
    writer wrote is touched beyond that one line.

    A shipped kind can be relabelled but keeps its id, because its id is what
    the app's own code refers to. A kind the WRITER added gets a new id and
    folder to match, since nothing else knows its old name.
    """
    registry = seed_registry(project_path)
    entry = type_by_id(registry, type_id)
    if entry is None:
        raise TypesError(f"This world has no kind called {type_id!r}.", "id")

    new_id, tidy = custom_type_id(label)
    new_label = pluralize(tidy)

    # A shipped kind keeps its identity: profiles.py, the migration and the
    # Profile Builder all name "character" directly. Renaming the label is
    # fine; renaming the id would strand them.
    shipped = type_id in {t["id"] for t in DEFAULT_TYPES}
    if shipped or new_id == type_id:
        entry["label"] = new_label
        _write_registry(project_path, registry)
        return registry

    if type_by_id(registry, new_id) is not None:
        raise TypesError(f"This world already has a kind called {new_id!r}.", "label")

    old_folder = entry.get("folder", "")
    new_folder = pluralize(new_id)
    if any(t.get("folder") == new_folder for t in registry["types"] if t is not entry):
        raise TypesError(f"The folder {new_folder!r} is already in use.", "folder")

    # Move the entries with the name. Both layouts, because a project may not
    # have been converted yet.
    for root in ("codex", "profiles"):
        source = os.path.join(project_path, root, old_folder)
        if not os.path.isdir(source):
            continue
        target = os.path.join(project_path, root, new_folder)
        os.rename(source, target)
        _retype_entries(target, type_id, new_id)

    entry["id"] = new_id
    entry["label"] = new_label
    entry["folder"] = new_folder
    _write_registry(project_path, registry)
    return registry


def _retype_entries(folder: str, old_id: str, new_id: str) -> None:
    """Update the `type:` line in each entry so the files still say what they
    are. Best-effort per file: one unreadable entry must not abandon the
    rename half-done."""
    try:
        names = [n for n in os.listdir(folder) if n.endswith(".md")]
    except OSError:
        return
    for name in names:
        path = os.path.join(folder, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read()
            updated = re.sub(rf"^type:\s*{re.escape(old_id)}\s*$",
                             f"type: {new_id}", raw, count=1, flags=re.MULTILINE)
            if updated != raw:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(updated)
        except OSError:
            continue


def delete_type(project_path: str, type_id: str) -> dict:
    """
    Remove a kind from this world.

    REFUSES WHILE IT HOLDS ANYTHING, and says how many. Deleting a section
    that contains a writer's entries would take their work with it, and no
    confirmation dialog makes that a good idea -- so the app declines and
    tells them what to do instead. An empty kind vanishes with nothing lost.

    A shipped kind is never deleted, only hidden: it is part of the app, and
    removing it from one project would mean the app's own code refers to
    something that is not there. hide_type is the right tool, and the message
    says so.
    """
    registry = seed_registry(project_path)
    entry = type_by_id(registry, type_id)
    if entry is None:
        raise TypesError(f"This world has no kind called {type_id!r}.", "id")

    held = count_entries(project_path, entry.get("folder", ""))
    if held:
        raise TypesError(
            f"{entry.get('label', type_id)} still holds {held} "
            f"{'entry' if held == 1 else 'entries'}. Delete or move those "
            f"first, or hide the section instead to keep them.",
            "id",
        )

    if type_id in {t["id"] for t in DEFAULT_TYPES}:
        raise TypesError(
            f"{entry.get('label', type_id)} is one of the kinds this app ships "
            f"with, so it cannot be removed. Hide the section instead.",
            "id",
        )

    registry["types"] = [t for t in registry["types"] if t.get("id") != type_id]
    # A relation that pointed at it would now name a type that does not
    # exist, which the validator refuses -- so drop those too.
    registry["relations"] = [
        r for r in registry.get("relations", [])
        if type_id not in r.get("source_types", [])
        and type_id not in r.get("target_types", [])
    ]
    _write_registry(project_path, registry)
    return registry


def set_type_group(project_path: str, type_id: str, group: str) -> dict:
    """Move a section to a different part of the sidebar. A writer whose
    world puts Factions with the people should be able to say so."""
    if group not in GROUPS:
        raise TypesError(
            f"{group!r} is not a sidebar group. Use one of: {', '.join(sorted(GROUPS))}.",
            "group",
        )
    registry = seed_registry(project_path)
    entry = type_by_id(registry, type_id)
    if entry is None:
        raise TypesError(f"This world has no kind called {type_id!r}.", "id")
    entry["group"] = group
    _write_registry(project_path, registry)
    return registry


def _write_registry(project_path: str, registry: dict) -> None:
    path = registry_path(project_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)
    os.replace(tmp, path)


def type_by_id(registry: dict, type_id: str) -> dict | None:
    for entry in registry.get("types", []):
        if entry.get("id") == type_id:
            return entry
    return None


def relation_by_id(registry: dict, rel_id: str) -> dict | None:
    for rel in registry.get("relations", []):
        if rel.get("id") == rel_id:
            return rel
    return None


def folder_for_type(registry: dict, type_id: str) -> str | None:
    entry = type_by_id(registry, type_id)
    return entry.get("folder") if entry else None


def inverse_label(registry: dict, rel_id: str) -> str | None:
    """
    The id to use when reading a Tie backwards.

    A symmetric relation is its own inverse -- "sibling of" reads the same
    from either end. Only ONE direction is ever stored; the other is derived
    here, because storing both lets them drift apart.
    """
    rel = relation_by_id(registry, rel_id)
    if rel is None:
        return None
    if rel.get("symmetric"):
        return rel_id
    return rel.get("inverse")


def relation_allows(registry: dict, rel_id: str, source_type: str, target_type: str) -> bool:
    """Is this connection meaningful between these two kinds of thing?"""
    rel = relation_by_id(registry, rel_id)
    if rel is None:
        return False
    if rel.get("universal"):
        # A plain connection runs between anything, including a kind the writer
        # added after this relation was written down.
        return True
    return (source_type in rel.get("source_types", [])
            and target_type in rel.get("target_types", []))


# ── Connections a writer names themselves ────────────────────────────────────
# The shipped vocabulary will always be short of somebody's world. A tool for
# writing invented cultures cannot ship the complete list of ways things in
# them relate, and pretending otherwise means a writer meets "nothing fits"
# and has nowhere to go.
#
# So relations are addable, exactly as types are, and the checker reads them
# from the registry rather than from code -- which is why a custom relation
# works everywhere with no further change.

def relation_id(label: str) -> str:
    """
    "Sworn enemy of" -> "sworn_enemy_of".

    Derived rather than asked for. A writer naming a connection is thinking
    about their world, not about identifiers, and the id only has to be stable
    and legal.
    """
    slug = re.sub(r"[^a-z0-9]+", "_", str(label or "").lower()).strip("_")
    slug = re.sub(r"^[^a-z]+", "", slug)[:40].rstrip("_")
    if not slug:
        raise TypesError("A connection needs a name with letters in it.",
                         "relations")
    return slug


def widen_relation(project_path: str, rel_id: str,
                   source_types: list[str], target_types: list[str]) -> dict:
    """
    Make an existing relation cover a pair the writer has just asked for.

    Needed because the shipped vocabulary grew. A writer typing their own name
    for a faction-to-deity connection can now land on a relation that already
    exists and does NOT run between those two kinds -- "sworn to destroy" ships
    for characters and factions, not for gods. Before, that produced a refusal
    for something the writer had explicitly requested, which is the kind of dead
    end this whole feature exists to remove.

    Only ever WIDENS, and only for the pair asked about. Nothing is removed, no
    other relation is touched, and a relation that already covers the pair is
    left byte-identical -- so this cannot quietly reshape a world the writer
    tuned by hand.
    """
    registry, _from_file = load_registry(project_path)
    relation = relation_by_id(registry, rel_id)
    if relation is None:
        raise TypesError(f"There is no connection called '{rel_id}'.", "relations")

    # A universal relation runs between anything already; widening its lists
    # would imply the lists mean something for it, which they do not.
    if relation.get("universal"):
        return registry

    changed = False
    for key, wanted in (("source_types", source_types),
                        ("target_types", target_types)):
        current = list(relation.get(key) or [])
        for kind in wanted:
            if kind and kind not in current:
                current.append(kind)
                changed = True
        relation[key] = current

    if not changed:
        return registry
    _write_registry(project_path, registry)
    return registry


def add_relation(
    project_path: str,
    label: str,
    source_types: list[str],
    target_types: list[str],
    *,
    symmetric: bool = False,
    inverse_label: str = "",
    cardinality: str = "many",
) -> dict:
    """
    Add a way things can connect, and return the saved registry.

    Refuses rather than guesses on every ambiguity: a name that yields no
    usable id, a duplicate, or a kind this world does not have. The last one
    matters most -- a relation naming a type that is not there is exactly what
    the validator rejects, so accepting it would write a file that then fails
    to load.
    """
    registry, _from_file = load_registry(project_path)

    text = " ".join(str(label or "").split())
    rid = relation_id(text)
    if relation_by_id(registry, rid) is not None:
        existing = relation_by_id(registry, rid)
        raise TypesError(
            f"This world already has a connection called "
            f"'{existing.get('label', rid)}'.",
            "relations",
        )

    known = {t.get("id") for t in registry.get("types", [])}
    for kind in list(source_types) + list(target_types):
        if kind not in known:
            raise TypesError(
                f"There is no '{kind}' in this world, so a connection cannot "
                f"run to or from one.",
                "relations",
            )
    if not source_types or not target_types:
        raise TypesError(
            "A connection needs a kind at each end.", "relations")

    inverse = ""
    if inverse_label.strip() and not symmetric:
        inverse = relation_id(inverse_label)

    registry["relations"].append({
        "id": rid,
        "label": text,
        "inverse": inverse or None,
        "symmetric": bool(symmetric),
        "source_types": list(source_types),
        "target_types": list(target_types),
        "cardinality": cardinality if cardinality in ("one", "many") else "many",
        "exclusive_group": None,
    })
    # Validated before it is written, so a bad addition is refused rather than
    # left on disk for the next read to choke on.
    validate_registry(registry)
    _write_registry(project_path, registry)
    return registry


def adopt_relation(project_path: str, rel_id: str) -> dict:
    """
    Take one of the connections this build ships with into THIS world.

    Needed because types.json is the writer's own file and is never silently
    modified. A project converted before a relation was added simply does not
    have it, and the honest fix is to offer it rather than to reach in and
    write it. See the recovery rule at the top of this module.
    """
    shipped = next((r for r in DEFAULT_RELATIONS if r["id"] == rel_id), None)
    if shipped is None:
        raise TypesError(f"'{rel_id}' is not a connection this app ships with.",
                         "relations")

    registry, _from_file = load_registry(project_path)
    known = {t.get("id") for t in registry.get("types", [])}
    if relation_by_id(registry, rel_id) is not None:
        # Already here -- but possibly NARROWER than what ships today. The
        # vocabulary grows in place ("owns" used to stop at objects; now a
        # manor is ownable), and a project converted before a widening has
        # the old shape in its own file. Adopting means accepting the shipped
        # coverage, so the world's copy is widened to it -- which only ever
        # ADDS kinds the world actually has, and a copy already as wide comes
        # back byte-identical with nothing written.
        return widen_relation(
            project_path, rel_id,
            [t for t in shipped["source_types"] if t in known],
            [t for t in shipped["target_types"] if t in known],
        )

    entry = dict(shipped)
    # Narrowed to the kinds this world actually has, so adopting a relation
    # into a world with a trimmed type list cannot write something invalid.
    entry["source_types"] = [t for t in entry["source_types"] if t in known]
    entry["target_types"] = [t for t in entry["target_types"] if t in known]
    if entry.get("universal"):
        # Its lists are decoration -- it runs between anything -- but the
        # validator still wants them non-empty and real.
        entry["source_types"] = entry["source_types"] or sorted(known)[:1]
        entry["target_types"] = entry["target_types"] or sorted(known)[:1]
    if not entry["source_types"] or not entry["target_types"]:
        raise TypesError(
            f"'{entry['label']}' connects kinds this world does not have.",
            "relations",
        )
    registry["relations"].append(entry)
    validate_registry(registry)
    _write_registry(project_path, registry)
    return registry


def relations_between(registry: dict, src_type: str, dst_type: str) -> list[dict]:
    """Every recorded connection that can run from one kind to the other."""
    return [
        r for r in registry.get("relations", [])
        if r.get("universal")
        or (src_type in r.get("source_types", [])
            and dst_type in r.get("target_types", []))
    ]


def shipped_relations_between(registry: dict, src_type: str,
                              dst_type: str) -> list[dict]:
    """
    Connections this build ships with that would fit, and that this world does
    not have yet.

    The point of offering these is that "nothing fits" is usually not true --
    it means the project was converted before the vocabulary grew. Showing
    them turns a dead end into a one-click decision the writer makes.

    A relation the world already HAS is offered too, when the world's copy
    does not cover this pair and the shipped one does. The vocabulary grows in
    place -- "owns" used to stop at objects, and now a manor is ownable -- and
    excluding by id alone made every widening invisible to every existing
    project: a fresh world could say "Lara owns Croft Manor" while a converted
    one hit a dead end on the same pair. Choosing the offer widens their copy
    (adds only, nothing removed) rather than duplicating it.
    """
    have = {str(r.get("id")): r for r in registry.get("relations", [])}
    known = {t.get("id") for t in registry.get("types", [])}
    if src_type not in known or dst_type not in known:
        return []

    def covers(rel: dict) -> bool:
        return bool(rel.get("universal")
                    or (src_type in rel.get("source_types", [])
                        and dst_type in rel.get("target_types", [])))

    offered: list[dict] = []
    for shipped in DEFAULT_RELATIONS:
        if not covers(shipped):
            continue
        mine = have.get(shipped["id"])
        if mine is None or not covers(mine):
            offered.append(dict(shipped))
    return offered
