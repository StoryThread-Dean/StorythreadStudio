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
from app.audiobook.wav_assembly import concat_wav, match_level
from app.audiobook.workspace import NARRATION_DEFAULTS

DEMO_VOICE = "af_heart"

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
    # is all that's needed. Hay-SOOS fuses to "Haysoos", ear-verified
    # (caps must fold: the engine reads caps runs as letters -- a brief
    # caps-preserving backtrack was disproven by bare-word measurement).
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
    # The narration SPEAKS each pace value while the listener experiences
    # it (user-shaped: hearing the value AT that speed ties the marker to
    # the sensation, so writers know exactly what to type). Step form
    # (2026-07-30 redesign): markers move in steps of 0.05 off the book's
    # base pace, capped to the proven 0.8-1.2 band -- every step lands on
    # a speed the engine renders cleanly, and no stack of steps can reach
    # S-L-O-W or chipmunk territory.
    "pace": (
        "This sentence moves at your book's base pace, straight from the "
        "narration settings."
        "\n\n[pause:0.5]\n\n"
        "[pace:-2]You are now hearing pace minus two: two small steps "
        "slower than the base. When a moment needs weight, slow the "
        "narration down, and let the scene breathe around the "
        "listener.[/pace]"
        "\n\n[pause:0.5]\n\n"
        "[pace:+2]And this is pace plus two, stepped up from the base. "
        "When the fight breaks out, the pace quickens, blow after blow, "
        "carrying the listener through the action.[/pace]"
        "\n\n[pause:0.5]\n\n"
        "Steps always move from your chosen base, and they stop at the "
        "tested limits, so the narration never crawls and never turns "
        "into a chipmunk."
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
                       rules: list, settings: dict | None = None) -> tuple[bytes, list[str]]:
    """
    The marker-aware renderer: any narration text -> one WAV, with real
    stitched silence for pauses/breaks, excluded spans skipped, and the
    full payload prep ([say] -> rules -> punctuation) applied per piece.
    Powers both the Hear-it demos and the select-text preview.

    The text runs through the SAME segment grouping generation uses
    (dialogue detection, pace boundaries, book-level narration settings),
    so a preview is an exact rehearsal of the real thing -- same speeds,
    same cut points, same silences.

    Returns (wav_bytes, parse_warnings, trace). The warnings matter for
    previews: a selection that cuts into a pace span would otherwise play
    at normal pace with no explanation. The TRACE is the ground truth of
    what was rendered -- one entry per spoken piece with the exact speed
    used and whether it was treated as dialogue -- so "the pace reverted"
    reports become checkable facts instead of ear-versus-ear debates.

    Raises ValueError when the text contains nothing narratable.
    """
    from app.audiobook import flow, segmenter
    from app.audiobook.generation import effective_pace

    settings = settings or dict(NARRATION_DEFAULTS)
    parsed = parse_narration(f"# Preview\n\n{text}")

    pieces: list[bytes | int] = []
    trace: list[dict] = []
    gap_ms = int(settings.get("paragraph_gap_ms", 0) or 0)
    for chapter in parsed.chapters:
        for item in segmenter._segment_texts_from_elements(chapter.elements):
            kind = item["kind"]
            # The inter-paragraph beat, on the same rule assembly uses:
            # only between two spoken pieces, never stacked on top of a
            # break or the writer's own pause. A preview that skipped this
            # would misrepresent the finished book.
            if (kind == "segment_text" and item.get("paragraph_start")
                    and gap_ms and pieces and isinstance(pieces[-1], bytes)):
                pieces.append(gap_ms)
            if kind == "segment_text":
                speed = effective_pace(item, settings)
                fragments = item.get("fragments")
                if fragments and len(fragments) >= 2:
                    # Flow segment: mid-paragraph pauses. Synthesize the
                    # run continuously and insert the pauses into the
                    # matched gaps -- the preview IS the generation path.
                    payloads = [prepare_tts_text(f, rules) for f in fragments]
                    audio, cuts, flowed = flow.synthesize_flow(
                        backend, voice_id, speed, payloads)
                    # One gain for the whole run, applied BEFORE the split:
                    # the pieces are one utterance and must not be levelled
                    # against each other.
                    pieces.extend(flow.split_flow_pieces(
                        match_level(audio), cuts, item.get("internal_pauses", [])))
                    for payload in payloads:
                        trace.append({
                            "speed": speed,
                            "dialogue": bool(item.get("dialogue")),
                            "marker_pace": item.get("pace"),
                            "snippet": payload[:32],
                            "flow": flowed,
                        })
                    continue
                payload = prepare_tts_text(item["text"], rules)
                audio, _duration = backend.synthesize(payload, voice_id, speed)
                # Each paragraph is its own request, and hosted engines
                # answer them at their own levels -- this is what stops
                # paragraph two arriving louder than paragraph one.
                pieces.append(match_level(audio))
                trace.append({
                    "speed": speed,
                    "dialogue": bool(item.get("dialogue")),
                    "marker_pace": item.get("pace"),
                    "snippet": payload[:32],
                })
            elif kind == "pause":
                pieces.append(int(item["duration_ms"]))
            elif kind == "scene_break":
                pieces.append(int(settings["scene_break_ms"]))
            elif kind == "chapter_break":
                pieces.append(int(settings["chapter_break_ms"]))

    if not any(isinstance(p, bytes) for p in pieces):
        raise ValueError(
            "Nothing to preview -- the selection contains only markers or "
            "excluded text."
        )
    # Leading silence (selection starts on a marker) has nothing to attach
    # to; drop gaps until the first spoken piece.
    while pieces and isinstance(pieces[0], int):
        pieces.pop(0)
    return concat_wav(pieces), list(parsed.warnings), trace


def build_demo(kind: str, backend: SynthesisBackend) -> bytes:
    """
    Render one marker demo to WAV bytes (cached per engine version).
    Raises KeyError for unknown kinds (the router turns that into a 400).
    """
    cache_key = (kind, backend.model_id, backend.engine_version)
    cached = _demo_cache.get(cache_key)
    if cached is not None:
        return cached

    audio, warnings, _trace = render_marked_text(DEMO_SCRIPTS[kind], backend, DEMO_VOICE, rules=[])
    assert not warnings, f"demo script '{kind}' must parse clean: {warnings}"
    _demo_cache[cache_key] = audio
    return audio
