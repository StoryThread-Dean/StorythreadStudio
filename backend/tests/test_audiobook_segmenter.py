# tests/test_audiobook_segmenter.py
# ==================================
# The segmenter's two contracts (spec 23/23.1):
#   SIZE     -- paragraph-level grouping toward 800-1,500 chars, sentence
#               fallback for oversize paragraphs, markers as hard cuts.
#   IDENTITY -- stable random IDs that SURVIVE editing: insert a paragraph
#               and exactly one new segment appears; everything else keeps
#               its ID, its status, and its generated audio fields.

from app.audiobook.markers import parse_narration
from app.audiobook.segmenter import (
    SEGMENT_MAX_CHARS,
    content_hash,
    resegment,
)


def _segments(manifest: dict) -> list[dict]:
    """All segment items across chapters, reading order."""
    return [item
            for chapter in manifest["chapters"]
            for item in chapter["items"]
            if item["kind"] == "segment"]


def _first_manifest(text: str) -> dict:
    return resegment(parse_narration(text), previous=None)


# ── Sizing ────────────────────────────────────────────────────────────────────

def test_small_paragraphs_group_into_one_segment():
    text = "# C1\n\nPara one.\n\nPara two.\n\nPara three."
    segments = _segments(_first_manifest(text))
    assert len(segments) == 1
    assert segments[0]["text"] == "Para one.\n\nPara two.\n\nPara three."


def test_grouping_respects_the_cap():
    # Two paragraphs of ~900 chars each cannot share a 1,500-char segment.
    para = ("All the light we cannot see fell across the road in ribbons. " * 15).strip()
    assert 800 < len(para) < SEGMENT_MAX_CHARS
    text = f"# C1\n\n{para}\n\n{para}"
    segments = _segments(_first_manifest(text))
    assert len(segments) == 2


def test_oversize_paragraph_falls_back_to_sentence_splits():
    sentence = "The snow kept falling over the ridge and the pines. "
    monster = (sentence * 60).strip()          # ~3,100 chars, one paragraph
    assert len(monster) > SEGMENT_MAX_CHARS
    segments = _segments(_first_manifest(f"# C1\n\n{monster}"))
    assert len(segments) >= 2
    for segment in segments:
        assert len(segment["text"]) <= SEGMENT_MAX_CHARS
    # No words lost in the split.
    assert " ".join(s["text"] for s in segments).split() == monster.split()


def test_markers_are_hard_cut_points_and_excludes_vanish():
    text = (
        "# C1\n\n"
        "Before the pause.\n\n"
        "[pause:0.8]\n\n"
        "After the pause.\n\n"
        "[exclude]Author note, never narrated.[/exclude]\n\n"
        "[scene-break]\n\n"
        "New scene."
    )
    manifest = _first_manifest(text)
    kinds = [item["kind"] for item in manifest["chapters"][0]["items"]]
    assert kinds == ["segment", "pause", "segment", "scene_break", "segment"]
    texts = [item["text"] for item in manifest["chapters"][0]["items"] if item["kind"] == "segment"]
    assert texts == ["Before the pause.", "After the pause.", "New scene."]
    # The pause carries its duration for assembly-time silence.
    pause = manifest["chapters"][0]["items"][1]
    assert pause["duration_ms"] == 800


def test_dialogue_paragraphs_segment_separately():
    text = ('# C1\n\nShe walked to the gate without hurrying.\n\n'
            '"You came back," he said. "After everything."\n\n'
            '"I always come back."\n\n'
            'The wind took whatever he said next.')
    segments = _segments(_first_manifest(text))
    assert [(s["text"].startswith('"'), s.get("dialogue", False)) for s in segments] == [
        (False, False),      # narration
        (True, True),        # both dialogue paragraphs group together
        (False, False),      # narration resumes
    ]


def test_dialogue_persists_across_pause_splits_inside_a_quote():
    # THE live finding (captured speeds 0.85/0.9/0.85/0.85 for ONE
    # speech): a [pause] inside a quotation splits it into fragments
    # where only the first carries the quote mark. All fragments of an
    # open quote are dialogue; the fragment AFTER the closing quote
    # is narration again.
    text = ('# C1\n\nLara watched her for a moment.\n\n'
            '"I don\'t know what the ritual was called.\n\n[pause:0.4]\n\n'
            'I don\'t even know if it had a name.\n\n[pause:0.4]\n\n'
            'I just know what they did."\n\n[pause:0.8]\n\n'
            'The silence stretched between them.')
    segments = _segments(_first_manifest(text))
    flags = [(s["text"][:20], s.get("dialogue", False)) for s in segments]
    assert flags == [
        ("Lara watched her for", False),
        ('"I don\'t know what t', True),
        ("I don't even know if", True),      # continuation: STILL dialogue
        ("I just know what the", True),      # closes the quote
        ("The silence stretche", False),     # narration resumes
    ]


def test_quote_dominant_paragraph_counts_as_dialogue():
    from app.audiobook.segmenter import is_dialogue_paragraph
    assert is_dialogue_paragraph('"Run," she said.')
    assert is_dialogue_paragraph("“Curly quotes too,” he agreed, nodding along without another word.")
    assert not is_dialogue_paragraph('He remembered her saying "run" once.')
    assert not is_dialogue_paragraph("No quotes at all in this paragraph.")


def test_punctuation_only_fragments_are_never_synthesized():
    # THE live hiccup: a quote mark left OUTSIDE a pace span became its
    # own fragment, and the engine rendered the bare punctuation as a
    # breath-like false start. Word-less fragments never become segments.
    text = ('# C1\n\nLara watched her for a moment.\n\n'
            '"[pace:1.2]So this ritual was performed, you saw it.[/pace]" '
            'Lexa set the book aside.')
    segments = _segments(_first_manifest(text))
    texts = [s["text"] for s in segments]
    assert '"' not in texts                       # the lone quote is gone
    assert all(any(ch.isalnum() for ch in t) for t in texts)
    # The real speech all survives.
    assert any("So this ritual" in t for t in texts)
    assert any("Lexa set the book" in t for t in texts)


def test_pace_changes_are_segment_boundaries():
    text = ("# C1\n\nNormal prose here.\n\n"
            "[pace:0.8]Slow passage.[/pace]\n\nNormal after.")
    segments = _segments(_first_manifest(text))
    assert [(s["text"], s.get("pace")) for s in segments] == [
        ("Normal prose here.", None),
        ("Slow passage.", 0.8),
        ("Normal after.", None),
    ]


def test_pace_edit_keeps_identity_and_updates_the_record():
    base = _first_manifest("# C1\n\nKeep me.\n\n[pause:0.4]\n\nSlow me down.")
    _mark_all_completed(base)
    target_id = next(s["segment_id"] for s in _segments(base) if s["text"] == "Slow me down.")

    edited = resegment(parse_narration(
        "# C1\n\nKeep me.\n\n[pause:0.4]\n\n[pace:0.8]Slow me down.[/pace]"),
        previous=base)
    target = next(s for s in _segments(edited) if s["text"] == "Slow me down.")
    # Same text = same identity (no new segment ID, audio pointer kept);
    # the pace rides the record so the payload basis will flag it stale.
    assert target["segment_id"] == target_id
    assert target["pace"] == 0.8
    assert target["status"] == "completed"


def test_every_segment_gets_a_stable_style_id_and_hash():
    segments = _segments(_first_manifest("# C1\n\nSome prose here."))
    assert segments[0]["segment_id"].startswith("seg-")
    assert segments[0]["content_hash"] == content_hash("Some prose here.")
    assert segments[0]["status"] == "pending"
    assert segments[0]["speaker_id"] == "narrator"    # speaker-aware from day one


# ── Identity across edits ─────────────────────────────────────────────────────

BOOK = (
    "# One\n\nAlpha paragraph.\n\nBeta paragraph.\n\n"
    "# Two\n\nGamma paragraph.\n\nDelta paragraph."
)


def _mark_all_completed(manifest: dict) -> None:
    """Simulate a finished generation run over every segment."""
    for segment in _segments(manifest):
        segment["status"] = "completed"
        segment["generated_hash"] = segment["content_hash"]
        segment["output_file"] = f"generated-segments/{segment['chapter_id']}/{segment['segment_id']}.flac"


def test_inserting_a_paragraph_creates_exactly_one_new_segment():
    first = _first_manifest(BOOK)
    _mark_all_completed(first)
    old_ids = {s["content_hash"]: s["segment_id"] for s in _segments(first)}

    # Small paragraphs group -- force distinct segments with pauses so the
    # insertion scenario matches the spec's story (positional shift).
    # Rebuild with an inserted paragraph between Alpha and Beta.
    edited = BOOK.replace("Alpha paragraph.\n\nBeta paragraph.",
                          "Alpha paragraph.\n\n[pause:0.5]\n\nInserted paragraph.\n\n[pause:0.5]\n\nBeta paragraph.")
    # First build the SAME segment layout for the original so hashes align.
    original = BOOK.replace("Alpha paragraph.\n\nBeta paragraph.",
                            "Alpha paragraph.\n\n[pause:0.5]\n\nBeta paragraph.")
    base = _first_manifest(original)
    _mark_all_completed(base)
    base_ids = {s["content_hash"]: s["segment_id"] for s in _segments(base)}

    second = resegment(parse_narration(edited), previous=base)
    segments = _segments(second)

    # Every pre-existing paragraph kept its ID, its completed status, and
    # its audio pointer -- no cascade.
    for segment in segments:
        if segment["text"] != "Inserted paragraph.":
            assert segment["segment_id"] == base_ids[segment["content_hash"]]
            assert segment["status"] == "completed"
            assert segment["output_file"]
    # Exactly one fresh segment, pending, with a brand-new ID.
    new = [s for s in segments if s["text"] == "Inserted paragraph."]
    assert len(new) == 1
    assert new[0]["status"] == "pending"
    assert new[0]["segment_id"] not in base_ids.values()
    # Nothing was superseded -- no old text disappeared.
    assert second["superseded"] == []
    # (old_ids unused beyond sanity -- the first build proves BOOK parses.)
    assert old_ids


def test_editing_a_paragraph_supersedes_only_that_segment():
    original = "# One\n\nKeep me.\n\n[pause:0.4]\n\nChange me.\n\n[pause:0.4]\n\nKeep me too."
    base = _first_manifest(original)
    _mark_all_completed(base)
    keep_ids = [s["segment_id"] for s in _segments(base) if s["text"] != "Change me."]
    changed_id = next(s["segment_id"] for s in _segments(base) if s["text"] == "Change me.")

    edited = original.replace("Change me.", "Changed completely.")
    second = resegment(parse_narration(edited), previous=base)

    segments = _segments(second)
    assert [s["segment_id"] for s in segments if s["text"] != "Changed completely."] == keep_ids
    replacement = next(s for s in segments if s["text"] == "Changed completely.")
    assert replacement["segment_id"] != changed_id
    assert replacement["status"] == "pending"
    # The old audio is superseded and retained, not silently dropped.
    assert [s["segment_id"] for s in second["superseded"]] == [changed_id]
    assert second["superseded"][0]["status"] == "superseded"


def test_chapter_renumbering_keeps_segment_identity():
    base = _first_manifest(BOOK)
    _mark_all_completed(base)
    gamma_before = next(s for s in _segments(base) if "Gamma" in s["text"])
    assert gamma_before["chapter_id"] == "chapter-002"

    # Insert a whole new chapter BEFORE chapter Two: Two renumbers to 003.
    edited = BOOK.replace("# Two", "# Interlude\n\nBrand new chapter prose.\n\n# Two")
    second = resegment(parse_narration(edited), previous=base)

    gamma_after = next(s for s in _segments(second) if "Gamma" in s["text"])
    # Same identity + audio, refreshed chapter home.
    assert gamma_after["segment_id"] == gamma_before["segment_id"]
    assert gamma_after["status"] == "completed"
    assert gamma_after["chapter_id"] == "chapter-003"


def test_pending_old_segments_do_not_pile_into_superseded():
    # A never-generated segment that disappears is just gone -- there is
    # no audio to retain, so superseded stays clean.
    base = _first_manifest("# One\n\nDoomed paragraph.")
    second = resegment(parse_narration("# One\n\nTotally different."), previous=base)
    assert second["superseded"] == []
