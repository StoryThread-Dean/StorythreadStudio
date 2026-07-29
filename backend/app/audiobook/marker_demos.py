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
    # Two demo words, two reasons to reach for [say] (user-shaped design):
    #   Saoirse -- a word the engine cannot guess (live finding: modern
    #   engines guess MOST words right, so pure-failure demos are a
    #   shrinking target; Kaelith sounded correct both times).
    #   Lara -- a name with several RIGHT answers (LOR-ah in America,
    #   LAR-ah in Britain, LAIR-ah in Spanish); the engine picks one, the
    #   STORY decides which one a given character uses. Forcing variants
    #   guarantees an audible contrast no engine improvement can erase.
    "say": (
        "Some names the narrator cannot guess. It reads Saoirse as written: Saoirse."
        "\n\n[pause:0.8]\n\n"
        "A say marker fixes it: [say:SER-sha]Saoirse[/say]."
        "\n\n[pause:1.0]\n\n"
        "Other names have more than one right answer. On its own, the narrator says: Lara."
        "\n\n[pause:0.8]\n\n"
        "Her English friends call her [say:LAR-ah]Lara[/say]."
        "\n\n[pause:0.8]\n\n"
        "In Madrid she introduces herself as [say:LAIR-ah]Lara[/say]."
    ),
    "exclude": (
        "This sentence is narrated normally."
        "\n\n[exclude]This author note sits in the text but is never spoken.[/exclude]\n\n"
        "And the narration continues as if the excluded text was never there."
    ),
}


def build_demo(kind: str, backend: SynthesisBackend) -> bytes:
    """
    Render one marker demo to WAV bytes. Raises KeyError for unknown
    kinds (the router turns that into a 400).
    """
    script = DEMO_SCRIPTS[kind]
    parsed = parse_narration(f"# Demo\n\n{script}")

    pieces: list[bytes | int] = []
    for element in parsed.chapters[0].elements:
        etype = element["type"]
        if etype == "text":
            payload = prepare_tts_text(element["content"], rules=[])
            audio, _duration = backend.synthesize(payload, DEMO_VOICE)
            pieces.append(audio)
        elif etype == "pause":
            pieces.append(int(element["duration_ms"]))
        elif etype == "scene_break":
            pieces.append(SCENE_BREAK_MS)
        elif etype == "chapter_break":
            pieces.append(CHAPTER_BREAK_MS)
        # excluded elements: skipped -- which is exactly the demo's point.

    return concat_wav(pieces)
