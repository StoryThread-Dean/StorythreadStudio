# codex/icon_keywords.py -- a small surprise for a name nobody expected us to know
# ================================================================================
# When a writer invents a kind of their own -- "Starfighter", "Demon Magic",
# "Dragon Cult" -- the app looks for a word it recognises and gives the
# section a fitting icon instead of the neutral fallback.
#
# It is a small thing and entirely cosmetic. What it buys is a moment: a
# writer types something they were sure was theirs alone, and the app answers
# with a little rocket. That is worth more to somebody learning a tool than
# another paragraph of help text.
#
# ---------------------------------------------------------------------------
# THE MATCHING RULES, which exist because the obvious approach gets them
# wrong
# ---------------------------------------------------------------------------
# 1. FIRST WORD WINS. "Demon Magic" is a demon, not a wand -- the writer put
#    Demon first, and the leading word is what a name is mostly about.
# 2. A WHOLE WORD BEATS A PART OF ONE. "Starfighter" is a spaceship, not a
#    star, even though "star" is sitting right there at the front. Exact
#    matches are tried before substrings so a compound gets its own answer.
# 3. LONGER SUBSTRINGS WIN. Where no exact match exists, "starlight" should
#    find "starlight" before it finds "star".
#
# Nothing here is authoritative about anything. A miss is the neutral icon,
# which is exactly what a writer got before this file existed.

# Every icon this can produce MUST be bundled by the frontend -- otherwise
# the surprise is a blank square. tests/test_codex_icon_keywords.py reads
# lexicon.ts and checks, because a cross-language contract that nothing
# verifies is a contract that quietly breaks.
KEYWORD_ICONS: dict[str, str] = {}


def _register(icon: str, *words: str) -> None:
    for word in words:
        KEYWORD_ICONS[word] = icon


# ── People and power ─────────────────────────────────────────────────────────
_register("Crown", "crown", "king", "queen", "throne", "royal", "royalty",
          "monarch", "monarchy", "emperor", "empress", "empire", "regent",
          "dynasty", "sovereign", "prince", "princess")
_register("Users", "council", "assembly", "senate", "clan", "tribe", "people",
          "folk", "cabal", "circle", "coven", "conclave", "syndicate")
_register("Scale", "law", "laws", "justice", "court", "trial", "judgement",
          "judgment", "tribunal", "magistrate")
_register("Coins", "guild", "merchant", "market", "trade", "coin", "gold",
          "currency", "bank", "treasury", "economy")

# ── Places ───────────────────────────────────────────────────────────────────
_register("Castle", "castle", "keep", "fortress", "citadel", "stronghold",
          "tower", "bastion", "palace", "hold")
_register("Mountain", "mountain", "peak", "summit", "highland", "cliff", "crag")
_register("Trees", "forest", "wood", "woods", "grove", "jungle", "thicket",
          "orchard")
_register("Waves", "sea", "ocean", "river", "tide", "lake", "bay", "water",
          "flood", "deep")
_register("Map", "realm", "region", "territory", "province", "domain",
          "borderland", "frontier", "map")
_register("Anchor", "harbour", "harbor", "port", "dock", "wharf")
_register("Tent", "camp", "caravan", "nomad", "encampment")

# ── The uncanny ──────────────────────────────────────────────────────────────
_register("Wand", "magic", "spell", "arcane", "enchant", "enchantment",
          "sorcery", "sorcerer", "wizard", "mage", "witch", "warlock",
          "incantation", "rune", "runes", "charm")
_register("Skull", "demon", "devil", "undead", "skeleton", "death", "wraith",
          "lich", "necromancy", "necromancer", "curse", "cursed", "plague")
_register("Ghost", "ghost", "spirit", "phantom", "haunt", "haunting",
          "shade", "revenant", "poltergeist")
_register("Flame", "dragon", "drake", "wyrm", "wyvern", "fire", "flame",
          "inferno", "ember", "ash", "pyre", "forge")
_register("Church", "temple", "church", "shrine", "cathedral", "chapel",
          "monastery", "abbey", "sanctum", "altar")
_register("Eye", "oracle", "seer", "prophecy", "vision", "watcher", "omen",
          "augury", "sight")

# ── Sky and season ───────────────────────────────────────────────────────────
_register("Star", "star", "starlight", "superstar", "constellation",
          "celestial", "starfall", "stardust")
_register("Moon", "moon", "lunar", "moonlight", "eclipse")
_register("Sun", "sun", "solar", "sunlight", "dawn", "daybreak")
_register("Zap", "storm", "lightning", "thunder", "tempest", "energy")
_register("Snowflake", "ice", "frost", "winter", "snow", "glacier", "frozen")
_register("Leaf", "herb", "herbs", "plant", "plants", "nature", "growth",
          "bloom", "garden", "flora")
_register("Wheat", "harvest", "farm", "grain", "field", "crop", "famine")

# ── Making and moving ────────────────────────────────────────────────────────
_register("Rocket", "starship", "starfighter", "spaceship", "spacecraft",
          "rocket", "shuttle", "voidship", "starcraft")
_register("Ship", "ship", "boat", "fleet", "navy", "vessel", "galleon",
          "sail", "armada", "frigate")
_register("Sword", "sword", "blade", "warrior", "knight", "soldier", "duel",
          "swordsman", "champion")
_register("Swords", "war", "battle", "army", "legion", "conflict", "siege",
          "campaign", "militia", "warband")
_register("Shield", "shield", "guard", "guardian", "defence", "defense",
          "ward", "sentinel", "bulwark", "warden")
_register("Hammer", "forge", "smith", "craft", "artisan", "anvil", "build")
_register("Pickaxe", "mine", "mines", "mining", "quarry", "excavation")
_register("Cog", "machine", "engine", "mechanism", "clockwork", "gear",
          "factory", "industry")
_register("Bot", "robot", "android", "automaton", "construct", "golem",
          "machinery")
_register("Atom", "science", "atom", "element", "particle", "physics")
_register("FlaskConical", "potion", "alchemy", "alchemist", "elixir",
          "poison", "brew", "tonic", "reagent")

# ── Living things ────────────────────────────────────────────────────────────
_register("PawPrint", "beast", "beasts", "wolf", "hound", "predator", "pack",
          "fang", "claw", "monster")
_register("Bird", "bird", "raven", "crow", "hawk", "eagle", "falcon", "wing",
          "flock", "roost")
_register("Fish", "fish", "shark", "leviathan", "kraken", "reef")
_register("Bug", "insect", "swarm", "hive", "spider", "locust")

# ── Words and things ─────────────────────────────────────────────────────────
_register("ScrollText", "scroll", "tome", "codex", "chronicle", "record",
          "annals", "archive", "manuscript", "ledger", "lexicon")
_register("Gem", "gem", "jewel", "crystal", "treasure", "relic", "artifact",
          "artefact", "hoard", "amulet", "talisman")
_register("Key", "key", "lock", "vault", "secret", "secrets", "cipher")
_register("Music", "song", "songs", "music", "bard", "ballad", "hymn",
          "chant", "melody")
_register("Clock", "time", "era", "age", "epoch", "calendar", "hour",
          "century", "chronology")
_register("Compass", "journey", "quest", "voyage", "expedition", "pilgrimage",
          "exploration")
_register("Footprints", "trail", "path", "road", "route", "migration",
          "exodus")
_register("Heart", "love", "romance", "bond", "oath", "vow", "devotion")


def icon_for_name(label: str) -> str | None:
    """
    An icon suggested by the words in a name, or None.

    None means "nothing recognised", and the caller uses its own default --
    a miss must look exactly like the world before this file existed.
    """
    if not label:
        return None

    words = [w for w in str(label).lower().replace("_", " ").split() if w]

    # RULE 1: first word wins. "Demon Magic" is a demon.
    for word in words:
        # RULE 2: a whole word beats a part of one, so "Starfighter" is a
        # spaceship rather than a star.
        exact = KEYWORD_ICONS.get(word)
        if exact:
            return exact

        # RULE 3: no exact match, so the longest keyword contained in this
        # word -- "starlight" before "star".
        matches = [k for k in KEYWORD_ICONS if len(k) >= 4 and k in word]
        if matches:
            return KEYWORD_ICONS[max(matches, key=len)]

    return None


def known_icon_names() -> set[str]:
    """Every icon this module can produce. Used by the test that checks the
    frontend actually bundles them."""
    return set(KEYWORD_ICONS.values())
