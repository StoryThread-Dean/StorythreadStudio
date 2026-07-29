# audiobook/marker_demos.py -- audible "What's this?" demos per marker.
# ======================================================================
# Explaining a pause in prose is fine; HEARING the pause is better. Each
# demo is a small marked-up script rendered through the real pipeline:
# marker parsing -> synthesis of the text pieces -> exact silence stitched
# in (wav_assembly). So the demo IS the feature, not a recording of it --
# when defaults or the engine change, the demos change with them.
#
# Demos always use the default voice (af_heart) so every writer hears the
# same reference, and the scripts avoid story-sample text on purpose --
# they narrate what the listener is experiencing.

from app.audiobook.markers import parse_narration
from app.audiobook.pronunciation import prepare_tts_text
from app.audiobook.synthesis import SynthesisBackend
from app.audiobook.wav_assembly import concat_wav

DEMO_VOICE = "af_heart"

# Spec 10.1 defaults for the break silences (configurable later; the
# demos read the same constants generation will).
SCENE_BREAK_MS = 2000
CHAPTER_BREAK_MS = 3000

DEMO_SCRIPTS: dict[str, str] = {
    "pause": (
        "A pause holds the silence for exactly as long as you ask."
        "\n\n[pause:1.5]\n\n"
        "That gap was a pause marker set to one and a half seconds."
    ),
    "scene-break": (
        "The scene ends on this sentence."
        "\n\n[scene-break]\n\n"
        "Two seconds of silence, and the new scene begins."
    ),
    "chapter-break": (
        "The chapter closes on this line."
        "\n\n[chapter-break]\n\n"
        "After three seconds of quiet, the story carries on."
    ),
    # Two demo words, two acts (user-shaped design, third iteration):
    #   Jesus -- the engine ALWAYS defaults to the English reading, so
    #   [say:HEY-zeus] forcing the Spanish name is a guaranteed audible
    #   contrast. (Kaelith sounded right both times; Saoirse got FIXED as
    #   a side effect of syllable fusion -- pure-failure demo words are a
    #   losing race against engine quality. Names where BOTH readings are
    #   correct and the story picks one can never be out-improved.)
    #   Lara -- three regional readings of one name; same principle.
    # The spoken respellings below are TUNED BY EAR against the live
    # engine (HEY-Zoosus, not HEY-zeus: the obvious spelling came out
    # "Zeheus"). When editing, always regenerate and LISTEN -- the right
    # respelling is whatever the engine renders correctly, not whatever
    # reads best on paper.
    # Script wording is the user's (2026-07-29 testing round). The first
    # "Jesus" doubles as the English-default demonstration -- one mention
    # is all that's needed. Hay-SOOS fuses to "Haysoos", ear-verified.
    "say": (
        "The local narrator gets most pronunciations right on its own. Reach "
        "for a say marker when a word needs a specific variation."
        "\n\n[pause:0.8]\n\n"
        "On its own, the narrator reads the name Jesus the English way. The "
        "say marker lets it speak the Spanish way instead: [say:Hay-SOOS]Jesus[/say]."
        "\n\n[pause:1.0]\n\n"
        "Other names have more than one pronunciation. Lara, for example: in "
        "Britain she would be [say:LAR-ah]Lara[/say]. If she was from Madrid, "
        "it might be [say:LAIR-ah]Lara[/say], or [say:LEER-ah]Lara[/say]."
        "\n\n[pause:1.0]\n\n"
        "Say works together with the Pronunciations dictionary. The "
        "dictionary changes how a name is spoken throughout the whole book. "
        "Say is for one specific spot, and when both apply, say wins. Set "
        "Lara's name once in the dictionary, and still let a waiter in "
        "Madrid call her [say:LAIR-ah]Lara[/say]."
        "\n\n[pause:0.8]\n\n"
        "Say is a powerful way to fine-tune your audiobook to just how you "
        "want it to sound."
    ),
    "pace": (
        "This sentence moves at the narrator's natural pace."
        "\n\n[pause:0.5]\n\n"
        "[pace:0.8]When a moment needs weight, slow the narration down, and "
        "let the scene breathe around the listener.[/pace]"
        "\n\n[pause:0.5]\n\n"
        "[pace:1.2]And when the fight breaks out, the pace quickens, blow "
        "after blow, carrying the listener through the action.[/pace]"
    ),
    "exclude": (
        "This sentence is narrated normally."
        "\n\n[exclude]This author note sits in the text but is never spoken.[/exclude]\n\n"
        "And the narration continues as if the excluded text was never there."
    ),
}


# Rendered demos, cached for the life of the backend process. Demos are
# deterministic per engine build, so the key is (kind, engine identity) --
# the first Hear-it click pays the synthesis cost, every later one
# (including after the frontend remounts) is instant.
_demo_cache: dict[tuple[str, str, str], bytes] = {}


def render_marked_text(text: str, backend: SynthesisBackend, voice_id: str,
                       rules: list) -> bytes:
    """
    The marker-aware renderer: any narration text -> one WAV, with real
    stitched silence for pauses/breaks, excluded spans skipped, and the
    full payload prep ([say] -> rules -> punctuation) applied per piece.
    Powers both the Hear-it demos and the select-text preview -- a small
    live rehearsal of exactly what full assembly will do at scale.

    Raises ValueError when the text contains nothing narratable.
    """
    parsed = parse_narration(f"# Preview\n\n{text}")

    pieces: list[bytes | int] = []
    for chapter in parsed.chapters:
        for element in chapter.elements:
            etype = element["type"]
            if etype == "text":
                payload = prepare_tts_text(element["content"], rules)
                audio, _duration = backend.synthesize(
                    payload, voice_id, element.get("pace", 1.0))
                pieces.append(audio)
            elif etype == "pause":
                pieces.append(int(element["duration_ms"]))
            elif etype == "scene_break":
                pieces.append(SCENE_BREAK_MS)
            elif etype == "chapter_break":
                pieces.append(CHAPTER_BREAK_MS)
            # excluded elements: skipped, exactly like real generation.

    if not any(isinstance(p, bytes) for p in pieces):
        raise ValueError(
            "Nothing to preview -- the selection contains only markers or "
            "excluded text."
        )
    # Leading silence (selection starts on a marker) has nothing to attach
    # to; drop gaps until the first spoken piece.
    while pieces and isinstance(pieces[0], int):
        pieces.pop(0)
    return concat_wav(pieces)


def build_demo(kind: str, backend: SynthesisBackend) -> bytes:
    """
    Render one marker demo to WAV bytes (cached per engine version).
    Raises KeyError for unknown kinds (the router turns that into a 400).
    """
    cache_key = (kind, backend.model_id, backend.engine_version)
    cached = _demo_cache.get(cache_key)
    if cached is not None:
        return cached

    audio = render_marked_text(DEMO_SCRIPTS[kind], backend, DEMO_VOICE, rules=[])
    _demo_cache[cache_key] = audio
    return audio
