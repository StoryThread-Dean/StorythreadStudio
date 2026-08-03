# test_audiobook_flow.py -- continuous synthesis for pause-split paragraphs.
# ===========================================================================
# Pins the fix for THE pre-pause slur (live listening tests, 2026-07-30):
# isolated fragment synthesis manufactures utterance endings, so
# mid-paragraph pauses must not cut the TEXT -- they cut the AUDIO of a
# continuous render, inside its natural sentence gaps, located by the
# duration-calibrated matcher in flow.py.

import array
import io
import wave

import pytest

from app.audiobook import flow, segmenter
from app.audiobook.markers import parse_narration
from app.audiobook.synthesis import SynthesisBackend

RATE = 24000


# ── Synthetic audio helpers ───────────────────────────────────────────────────
# Engineered WAVs: (duration_ms, amplitude) runs. Amplitude 4000 reads as
# speech to the matcher; 0 is silence. A 100Hz square wave keeps RMS high
# without needing numpy.

def make_wav(runs: list[tuple[int, int]]) -> bytes:
    samples = array.array("h")
    for ms, amplitude in runs:
        n = RATE * ms // 1000
        if amplitude == 0:
            samples.extend([0] * n)
        else:
            period = RATE // 100
            samples.extend(
                amplitude if (i % period) < period // 2 else -amplitude
                for i in range(n)
            )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(samples.tobytes())
    return buf.getvalue()


def wav_ms(audio: bytes) -> int:
    with wave.open(io.BytesIO(audio), "rb") as w:
        return w.getnframes() * 1000 // w.getframerate()


# ── The matcher ───────────────────────────────────────────────────────────────

def test_matcher_finds_boundaries_inside_duration_bands():
    # Three fragments: 800ms, 1000ms, and a long one containing a 260ms
    # COMMA DECOY gap. Naive longest-gap matching would jump at the
    # decoy; the bands keep every boundary honest.
    group = make_wav([
        (800, 4000), (100, 0),                  # fragment 1 | gap 1
        (1000, 4000), (300, 0),                 # fragment 2 | gap 2
        (900, 4000), (260, 0), (840, 4000),     # fragment 3 with comma decoy
    ])
    cuts = flow.match_cut_points(group, [820, 1050, 2050])
    assert cuts is not None
    b1, b2 = cuts
    assert 800 <= b1 <= 900                     # midpoint of gap 1
    assert 1900 <= b2 <= 2200                   # midpoint of gap 2

def test_matcher_returns_none_when_a_band_has_no_gap():
    # Continuous speech with no gap where fragment 1 should end.
    group = make_wav([(2500, 4000)])
    assert flow.match_cut_points(group, [800, 1600]) is None


def test_matcher_rejects_a_decoy_when_the_tail_cannot_be_the_last_fragment():
    # A gap sits in fragment 1's band, but what remains after it is far
    # too long to be fragment 2 -- the sanity check refuses to guess.
    group = make_wav([(700, 4000), (80, 0), (4700, 4000)])
    assert flow.match_cut_points(group, [800, 1500]) is None


# ── Splitting for the stitcher ────────────────────────────────────────────────

def test_split_flow_pieces_inserts_the_current_pauses():
    audio = make_wav([(1000, 4000)])
    pieces = flow.split_flow_pieces(audio, cuts_ms=[400], pauses_ms=[250])
    assert [type(p) for p in pieces] == [bytes, int, bytes]
    assert pieces[1] == 250
    assert abs(wav_ms(pieces[0]) - 400) <= 5
    assert abs(wav_ms(pieces[2]) - 600) <= 5


def test_split_flow_pieces_survives_a_pause_count_mismatch():
    # Narration edited since generation (segment already queued stale):
    # pair what exists, play the rest gapless -- never crash the export.
    audio = make_wav([(900, 4000)])
    pieces = flow.split_flow_pieces(audio, cuts_ms=[300, 600], pauses_ms=[200])
    kinds = [type(p) for p in pieces]
    assert kinds == [bytes, int, bytes, bytes]


# ── synthesize_flow ───────────────────────────────────────────────────────────

class ScriptedWavBackend(SynthesisBackend):
    """Returns engineered WAVs per exact payload text."""
    key = "scripted"
    model_id = "scripted-tts"
    engine_version = "scripted 1.0"
    file_extension = "wav"

    def __init__(self, script: dict[str, bytes]):
        self.script = script
        self.calls: list[str] = []

    def synthesize(self, text: str, voice_id: str, speed: float = 1.0):
        self.calls.append(text)
        audio = self.script[text]
        return audio, wav_ms(audio) / 1000.0


def test_synthesize_flow_returns_the_continuous_render_with_cuts():
    f1, f2 = "First sentence here.", "Second sentence follows."
    iso1 = make_wav([(800, 4000), (150, 0)])       # isolated: speech + engine tail
    iso2 = make_wav([(1100, 4000), (150, 0)])
    group = make_wav([(750, 4000), (120, 0), (1050, 4000)])
    backend = ScriptedWavBackend({f1: iso1, f2: iso2, f"{f1} {f2}": group})

    audio, cuts, flowed = flow.synthesize_flow(backend, "v", 1.0, [f1, f2])
    assert flowed is True
    assert audio == group                          # the continuous render, untouched
    assert len(cuts) == 1 and 750 <= cuts[0] <= 900
    # Isolated fragments were synthesized too -- they are the calibration.
    assert backend.calls == [f1, f2, f"{f1} {f2}"]


def test_synthesize_flow_falls_back_to_concatenated_fragments():
    f1, f2 = "One.", "Two."
    iso1 = make_wav([(600, 4000)])
    iso2 = make_wav([(700, 4000)])
    # The group render has NO detectable gap -- matching must not guess.
    group = make_wav([(1100, 4000)])
    backend = ScriptedWavBackend({f1: iso1, f2: iso2, f"{f1} {f2}": group})

    audio, cuts, flowed = flow.synthesize_flow(backend, "v", 1.0, [f1, f2])
    assert flowed is False
    assert cuts == [600]                           # the join between the clips
    assert abs(wav_ms(audio) - 1300) <= 5          # concat of the isolated clips


# ── Segmenter: flow groups form (and do not form) correctly ──────────────────

def _items(text: str) -> list[dict]:
    parsed = parse_narration(text)
    return segmenter._segment_texts_from_elements(parsed.chapters[0].elements)


def test_mid_paragraph_pauses_form_one_flow_segment():
    items = _items(
        '# C\n\n"A cult. [pause:0.4] An old one. [pause:0.8] '
        'They worshipped a pair of deities."'
    )
    assert len(items) == 1
    item = items[0]
    assert item["kind"] == "segment_text"
    assert item["fragments"] == [
        '"A cult.', "An old one.", 'They worshipped a pair of deities."',
    ]
    assert item["internal_pauses"] == [400, 800]
    assert item["text"] == ('"A cult. An old one. '
                            'They worshipped a pair of deities."')
    assert item.get("dialogue") is True


def test_paragraph_boundary_pauses_still_cut_segments():
    items = _items(
        "# C\n\nFirst paragraph.\n\n[pause:0.6]\n\nSecond paragraph."
    )
    assert [i["kind"] for i in items] == ["segment_text", "pause", "segment_text"]
    assert all("fragments" not in i for i in items)


def test_flow_group_ends_at_a_paragraph_break():
    items = _items(
        "# C\n\nShe hesitated. [pause:0.4] Then decided.\n\nA new paragraph."
    )
    assert [i["kind"] for i in items] == ["segment_text", "segment_text"]
    assert items[0]["fragments"] == ["She hesitated.", "Then decided."]
    assert "fragments" not in items[1]


def test_trailing_mid_paragraph_pause_is_emitted_after_the_group():
    # The pause has prose before it but a pace change right after -- the
    # group closes on the pause, which then stands alone in order.
    items = _items(
        "# C\n\nHe waited. [pause:0.4] He counted. [pause:0.9] "
        "[pace:-2]The door opened.[/pace]"
    )
    kinds = [(i["kind"], i.get("duration_ms")) for i in items]
    assert kinds == [("segment_text", None), ("pause", 900), ("segment_text", None)]
    assert items[0]["fragments"] == ["He waited.", "He counted."]
    assert items[0]["internal_pauses"] == [400]
    assert items[2].get("pace") == "-2"


def test_wordless_fragment_between_pauses_merges_the_silences():
    # A wordless fragment (stray punctuation) between two pauses is never
    # synthesized; its two pauses become one 1000ms silence. (A lone
    # QUOTE mark is different -- it flips dialogue state, which is a real
    # segment boundary, covered below.)
    items = _items('# C\n\nShe spoke. [pause:0.4] ... [pause:0.6] He left.')
    assert len(items) == 1
    assert items[0]["fragments"] == ["She spoke.", "He left."]
    assert items[0]["internal_pauses"] == [1000]


def test_a_quote_opening_between_pauses_splits_the_group():
    # 'She spoke. [pause] " [pause] He left.' -- the lone quote OPENS
    # dialogue, so what follows runs at Dialogue Pace and cannot share a
    # continuous render with the narration before it.
    items = _items('# C\n\nShe spoke. [pause:0.4] " [pause:0.6] He left.')
    kinds = [i["kind"] for i in items]
    assert kinds == ["segment_text", "pause", "pause", "segment_text"]
    assert items[0].get("dialogue") is None or not items[0].get("dialogue")
    assert items[3].get("dialogue") is True


def test_flow_attributes_survive_resegmentation():
    text = '# C\n\n"Stay. [pause:0.4] Please stay."'
    parsed = parse_narration(text)
    manifest = segmenter.resegment(parsed, None)
    segment = manifest["chapters"][0]["items"][0]
    assert segment["fragments"] == ['"Stay.', 'Please stay."']
    assert segment["internal_pauses"] == [400]

    # Retiming the pause keeps the segment's identity AND its layout;
    # only the stored pause duration moves.
    retimed = parse_narration('# C\n\n"Stay. [pause:1.2] Please stay."')
    second = segmenter.resegment(retimed, manifest)
    seg2 = second["chapters"][0]["items"][0]
    assert seg2["segment_id"] == segment["segment_id"]
    assert seg2["internal_pauses"] == [1200]
    assert seg2["fragments"] == segment["fragments"]


def test_layout_fingerprint_moves_when_a_pause_relocates():
    from app.audiobook.generation import segment_layout
    a = _items('# C\n\nOne two. [pause:0.4] Three four five.')[0]
    b = _items('# C\n\nOne two. Three four. [pause:0.4] Five.')[0]
    assert segment_layout(a) != segment_layout(b)
    # Plain segments have no layout at all.
    plain = _items('# C\n\nJust one sentence.')[0]
    assert segment_layout({**plain}) == ""


# ── Preview parity ────────────────────────────────────────────────────────────

def test_preview_renders_flow_groups_continuously():
    from app.audiobook.marker_demos import render_marked_text

    f1, f2 = '"A cult.', 'An old one."'
    iso1 = make_wav([(700, 4000), (120, 0)])
    iso2 = make_wav([(900, 4000), (120, 0)])
    group = make_wav([(650, 4000), (110, 0), (850, 4000)])
    backend = ScriptedWavBackend({f1: iso1, f2: iso2, f"{f1} {f2}": group})

    audio, warnings, trace = render_marked_text(
        '"A cult. [pause:0.4] An old one."', backend, "v", rules=[])
    assert warnings == []
    # One trace entry per fragment, flagged as flow.
    assert [t.get("flow") for t in trace] == [True, True]
    # The output carries the inserted 400ms: continuous render length
    # plus the pause, minus whatever edge conditioning trimmed.
    assert wav_ms(audio) == pytest.approx(wav_ms(group) + 400, abs=150)