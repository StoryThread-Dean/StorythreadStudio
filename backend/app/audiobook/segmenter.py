# audiobook/segmenter.py -- narration text -> generation segments.
# =================================================================
# Turns the parsed narration (markers.py's chapters + elements) into the
# ordered list of SEGMENTS that speech providers will actually receive,
# plus the silence items between them. Spec sections 23 and 23.1.
#
# The two rules that make this file matter:
#
# 1. SIZE: ONE PARAGRAPH, ONE SEGMENT. A paragraph over the 1,500-char cap
#    falls back to sentence splits. Paragraphs used to GROUP up to the cap
#    and travel as one request joined by a blank line, which was cheaper
#    in requests and turned out to be wrong: an engine is free to ignore
#    that blank line, and some do, so paragraph two began milliseconds
#    after paragraph one with no beat between them. A boundary the
#    pipeline cannot see is a boundary it cannot time. Per-character
#    pricing means the split costs nothing extra.
#
# 2. IDENTITY: segment IDs are STABLE RANDOM IDs, never positional. When
#    the narration changes and segmentation re-runs, unchanged segments
#    are re-matched by content hash (longest common subsequence, order
#    preserving) and KEEP their ID, their generated audio, and their
#    generated-state fields. Inserting one paragraph mid-chapter produces
#    exactly ONE new segment -- not a cascade of false "changed" segments
#    to the end of the book. Matching runs BOOK-WIDE, so retitling or
#    renumbering a chapter never orphans its audio either.
#
# Storage: one manifest for the whole book at
# generated-segments/segments.json -- chapters in order, each with its
# ordered items (segments and silences), plus a superseded list holding
# replaced segments until cleanup.

import hashlib
import os
import re
import uuid

from app.audiobook.jsonstore import read_json, write_json_atomic
from app.audiobook.markers import ParsedNarration

# Bumped to 2 when paragraphs stopped grouping into shared segments. The
# version exists so a change in HOW text is cut re-runs segmentation
# rather than leaving a book half-cut by two different rules.
SEGMENTS_VERSION = 2

# Spec 23.1 sizing targets. MAX is the grouping cap; a single paragraph
# larger than MAX is sentence-split into chunks no bigger than MAX.
SEGMENT_MAX_CHARS = 1500

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")

# Dialogue detection (paragraph-level, deliberately): a paragraph that
# opens with a quote mark, or whose characters are mostly inside quotes,
# is dialogue. Paragraph-level avoids mid-sentence synthesis seams
# ('"Run," she said' stays one piece) and matches how fiction is
# paragraphed. Dialogue paragraphs segment separately so the book-level
# Dialogue Pace setting can apply to them alone -- the engine's own pace
# inference goes wildest on dialogue (live finding: chipmunk speed-ups).
_QUOTE_OPEN = {'"', "“"}


def is_dialogue_paragraph(paragraph: str) -> bool:
    stripped = paragraph.lstrip()
    if stripped[:1] in _QUOTE_OPEN:
        return True
    quoted = 0
    in_quote = False
    for ch in paragraph:
        if ch == '"':
            in_quote = not in_quote
        elif ch == "“":
            in_quote = True
        elif ch == "”":
            in_quote = False
        elif in_quote:
            quoted += 1
    return len(paragraph) > 0 and quoted / len(paragraph) > 0.5


def _new_segment_id() -> str:
    """Short, stable, greppable -- same style as structure_store act IDs."""
    return "seg-" + uuid.uuid4().hex[:8]


def content_hash(text: str) -> str:
    """
    The identity of a segment's text. Hashed over the RAW narration text of
    the segment -- including inline [say:...] markup, which is deliberate:
    editing a [say] changes the audio, so it must change the identity.
    """
    return "sha256-" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _split_oversize_paragraph(paragraph: str) -> list[str]:
    """Sentence-split a too-big paragraph into chunks under the cap."""
    sentences = _SENTENCE_END_RE.split(paragraph)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = (current + " " + sentence).strip() if current else sentence
        if current and len(candidate) > SEGMENT_MAX_CHARS:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
        # A single monster sentence beyond the cap still ships whole --
        # cutting mid-sentence would create an audible seam. Providers'
        # own hard limits are enforced at request time in a later stage.
    if current:
        chunks.append(current)
    return chunks


def _segment_texts_from_elements(elements: list[dict]) -> list[dict]:
    """
    One chapter's parsed elements -> ordered items:
      {"kind": "segment_text", "text": ...}   speech to generate
      {"kind": "pause", "duration_ms": ...}   assembly-time silence
      {"kind": "scene_break"} / {"kind": "chapter_break"}
    Excluded elements vanish here -- they are never narrated. Markers act
    as hard segment boundaries (they are CUT POINTS, spec 10.3) -- with
    ONE refinement: a MID-PARAGRAPH pause does not cut the speech into
    separate segments. Isolated fragment synthesis manufactures utterance
    endings (cold onset, stretched delivery, breathy release -- see
    flow.py), so the fragments around mid-paragraph pauses stay together
    as one FLOW segment:
      {"kind": "segment_text", "text": <fragments joined>,
       "fragments": [f1, f2, ...], "internal_pauses": [ms, ...]}
    synthesized continuously, with the pauses inserted into the audio's
    natural gaps at stitch time.
    """
    items: list[dict] = []
    pending_paragraphs: list[str] = []
    pending_len = 0
    pending_pace = 1.0
    # Who is speaking. "" is the narrator. Like pace, a change is a hard
    # segment boundary -- one segment, one voice -- and the value rides
    # the segment record so generation can resolve it per segment.
    pending_voice = ""
    pending_dialogue = False
    # True when the pending text OPENS a paragraph. Assembly reads this to
    # decide where the inter-paragraph beat belongs -- the continuation
    # pieces of one oversize paragraph must not get one.
    pending_paragraph_start = False
    # The open flow group: fragments accumulated across mid-paragraph
    # pauses. Invariant: pauses trail fragments -- after fragment k is
    # added its pause follows, so len(pauses) == len(fragments) until the
    # next fragment arrives.
    group_fragments: list[str] = []
    group_pauses: list[int] = []
    # Quote state carries ACROSS fragments: a [pause] inside a speech
    # splits it into pieces where only the first carries the opening
    # quote mark. Without this, continuation fragments fell back to
    # narrator pace -- one speech changing speed mid-flow (live finding:
    # captured speeds [0.85, 0.9, 0.85, 0.85] for a single quotation).
    in_quote = False

    def _update_quote_state(paragraph: str) -> None:
        nonlocal in_quote
        for ch in paragraph:
            if ch == '"':
                in_quote = not in_quote
            elif ch == "“":
                in_quote = True
            elif ch == "”":
                in_quote = False

    def _take_pending() -> str | None:
        """Drain pending paragraphs to one text, or None when there is
        nothing speakable. Never synthesize a fragment with no words in
        it: a pace span opening just inside a quote leaves a lone '"'
        fragment, and the engine renders bare punctuation as a
        breath-like false start (live finding: an audible hiccup)."""
        nonlocal pending_paragraphs, pending_len
        if not pending_paragraphs:
            return None
        text = "\n\n".join(pending_paragraphs)
        pending_paragraphs = []
        pending_len = 0
        return text if re.search(r"[A-Za-z0-9]", text) else None

    def flush() -> None:
        """Close the open flow group (if any) and the pending text into
        emitted items. Every hard boundary funnels through here."""
        nonlocal group_fragments, group_pauses, pending_paragraph_start
        starts_paragraph = pending_paragraph_start
        pending_paragraph_start = False
        text = _take_pending()
        if group_fragments:
            fragments = group_fragments
            pauses = group_pauses
            group_fragments = []
            group_pauses = []
            if text is not None:
                fragments.append(text)
            # Interleave shape: pauses[i] follows fragments[i]. With a
            # final fragment there are n-1 internal pauses; without one
            # (the group ended on a pause) the last pause trails the
            # group and is emitted as a plain pause item.
            trailing = pauses[len(fragments) - 1:] if fragments else pauses
            internal = pauses[: max(0, len(fragments) - 1)]
            if len(fragments) == 1:
                item = {"kind": "segment_text", "text": fragments[0]}
            elif fragments:
                item = {"kind": "segment_text",
                        "text": " ".join(fragments),
                        "fragments": fragments,
                        "internal_pauses": internal}
            else:
                item = None
            if item is not None:
                if pending_pace != 1.0:
                    item["pace"] = pending_pace
                if pending_voice:
                    item["voice"] = pending_voice
                if pending_dialogue:
                    item["dialogue"] = True
                if starts_paragraph:
                    item["paragraph_start"] = True
                items.append(item)
            for ms in trailing:
                items.append({"kind": "pause", "duration_ms": ms})
            return
        if text is not None:
            item = {"kind": "segment_text", "text": text}
            if pending_pace != 1.0:
                item["pace"] = pending_pace
            if pending_voice:
                item["voice"] = pending_voice
            if pending_dialogue:
                item["dialogue"] = True
            if starts_paragraph:
                item["paragraph_start"] = True
            items.append(item)

    for element in elements:
        etype = element.get("type")
        if etype == "text":
            # A pace change is a hard boundary -- one segment, one speed.
            pace = element.get("pace", 1.0)
            if pace != pending_pace:
                flush()
                pending_pace = pace
            # A voice change is the hardest boundary of all: two speakers
            # can never share one synthesis request.
            voice = element.get("voice", "")
            if voice != pending_voice:
                flush()
                pending_voice = voice
            # Paragraphs group until the cap; oversize paragraphs split.
            # A dialogue/narration change is ALSO a boundary, so the
            # book-level Dialogue Pace can act on dialogue segments alone.
            for paragraph_index, paragraph in enumerate(element["content"].split("\n\n")):
                paragraph = paragraph.strip()
                if not paragraph:
                    continue
                # A real paragraph break ends any open flow group -- flow
                # groups never span paragraphs. (Index 0 right after a
                # mid-paragraph pause is the CONTINUATION of the split
                # paragraph, so the group stays open for it.)
                if paragraph_index > 0 and group_fragments:
                    flush()
                # Inside an unclosed quote, every fragment is dialogue
                # regardless of its own quote marks -- EXCEPT when the
                # fragment BEGINS with the closing quote (a pace span
                # ending right at the quote leaves '" Lexa set the book
                # aside...'), in which case the quote char belongs to the
                # PREVIOUS speech and the rest is judged on its own.
                stripped = paragraph.lstrip()
                if in_quote and stripped[:1] in ('"', "”"):
                    rest = stripped[1:].lstrip()
                    dialogue = bool(rest) and is_dialogue_paragraph(rest)
                else:
                    dialogue = in_quote or is_dialogue_paragraph(paragraph)
                _update_quote_state(paragraph)
                if dialogue != pending_dialogue:
                    flush()
                    pending_dialogue = dialogue
                # ONE PARAGRAPH, ONE SEGMENT. Paragraphs used to group up
                # to the character cap and travel as a single request
                # joined by a blank line -- but an engine is free to
                # ignore that blank line, and several do: paragraph two
                # arrived milliseconds after paragraph one with no beat
                # between them (live finding, Voxtral). A boundary the
                # pipeline cannot see is a boundary it cannot time, so a
                # true paragraph break now closes the previous segment.
                # The gap itself is inserted at assembly from
                # paragraph_gap_ms, so retiming it later costs nothing.
                #
                # Cost is unchanged: hosted engines bill per character,
                # not per request.
                #
                # A paragraph at index 0 with work already open is NOT a
                # new paragraph -- it is the continuation of one split by
                # a mid-paragraph pause or an inline exclusion, and
                # flushing there would break the flow group that exists
                # to keep such a sentence sounding continuous.
                if paragraph_index > 0 or not (group_fragments or pending_paragraphs):
                    flush()
                    pending_paragraph_start = True
                pieces = ([paragraph] if len(paragraph) <= SEGMENT_MAX_CHARS
                          else _split_oversize_paragraph(paragraph))
                for piece in pieces:
                    if pending_len and pending_len + len(piece) > SEGMENT_MAX_CHARS:
                        flush()
                    pending_paragraphs.append(piece)
                    pending_len += len(piece)
                    if pending_len >= SEGMENT_MAX_CHARS:
                        flush()
        elif etype == "excluded":
            continue
        elif etype == "pause":
            if element.get("mid_paragraph"):
                # The pause splits a sentence run, not two paragraphs:
                # bank the text so far as a flow fragment and keep going.
                text = _take_pending()
                if text is not None:
                    group_fragments.append(text)
                if group_fragments:
                    if len(group_pauses) >= len(group_fragments):
                        # The fragment between two pauses had no words in
                        # it (a lone quote mark) -- merge the silences.
                        group_pauses[-1] += element["duration_ms"]
                    else:
                        group_pauses.append(element["duration_ms"])
                else:
                    # Nothing speakable before it -- a pause cannot anchor
                    # a flow group; emit it plainly.
                    items.append({"kind": "pause", "duration_ms": element["duration_ms"]})
            else:
                flush()
                items.append({"kind": "pause", "duration_ms": element["duration_ms"]})
        elif etype in ("scene_break", "chapter_break"):
            flush()
            items.append({"kind": etype})
    flush()
    return items


# ── Book-wide re-matching ─────────────────────────────────────────────────────

def _lcs_match(old_hashes: list[str], new_hashes: list[str]) -> dict[int, int]:
    """
    Longest common subsequence over content hashes. Returns
    {new_index: old_index} for every matched pair -- order preserving, so
    a hash that appears twice resolves in reading order.
    """
    n, m = len(old_hashes), len(new_hashes)
    # Classic DP table; ~500x500 for a full novel, comfortably cheap.
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            if old_hashes[i] == new_hashes[j]:
                dp[i][j] = dp[i + 1][j + 1] + 1
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])
    matches: dict[int, int] = {}
    i = j = 0
    while i < n and j < m:
        if old_hashes[i] == new_hashes[j]:
            matches[j] = i
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return matches


def resegment(parsed: ParsedNarration, previous: dict | None) -> dict:
    """
    Build the book-wide segments manifest, carrying identity forward.

    `previous` is the manifest from the last run (None on first import).
    Matched segments keep segment_id + every generated-state field; old
    segments whose text no longer exists anywhere move to `superseded`
    (their audio is retained until cleanup, spec 24.4).
    """
    # Flatten the previous manifest's segments in reading order.
    old_segments: list[dict] = []
    if previous:
        for chapter in previous.get("chapters", []):
            for item in chapter.get("items", []):
                if item.get("kind") == "segment":
                    old_segments.append(item)
    old_hashes = [s["content_hash"] for s in old_segments]

    # Build the new item skeleton per chapter, collecting new segment
    # texts book-wide for one global match.
    new_chapters: list[dict] = []
    new_segment_slots: list[dict] = []      # references into new_chapters items
    for order, chapter in enumerate(parsed.chapters, start=1):
        chapter_id = f"chapter-{order:03d}"
        items: list[dict] = []
        for raw in _segment_texts_from_elements(chapter.elements):
            if raw["kind"] == "segment_text":
                segment = {
                    "kind": "segment",
                    "segment_id": None,          # filled below
                    "chapter_id": chapter_id,
                    "speaker_id": "narrator",    # spec 27.1: speaker-aware from day one
                    "text": raw["text"],
                    "content_hash": content_hash(raw["text"]),
                    "status": "pending",
                }
                if raw.get("pace"):
                    segment["pace"] = raw["pace"]
                if raw.get("voice"):
                    # The NAME the writer wrote, not a voice id. Resolving
                    # it against the cast happens at generation, so
                    # recasting a character re-renders her lines without
                    # touching a word of the narration copy.
                    segment["voice"] = raw["voice"]
                if raw.get("dialogue"):
                    segment["dialogue"] = True
                if raw.get("paragraph_start"):
                    # Layout, not speech: assembly puts the inter-paragraph
                    # beat before this segment. Deliberately NOT part of
                    # content_hash -- moving a paragraph break must not
                    # force a re-render of audio whose words are the same.
                    segment["paragraph_start"] = True
                if raw.get("fragments"):
                    # Flow segment (mid-paragraph pauses): the fragment
                    # layout drives continuous synthesis + cut matching;
                    # the pause durations stay OUT of the payload basis
                    # so retiming a pause never regenerates speech.
                    segment["fragments"] = raw["fragments"]
                    segment["internal_pauses"] = raw.get("internal_pauses", [])
                items.append(segment)
                new_segment_slots.append(segment)
            else:
                items.append(raw)                # pause / scene_break / chapter_break
        new_chapters.append({
            "chapter_id": chapter_id,
            "title": chapter.title,
            "items": items,
        })

    # Global identity match: unchanged text keeps its segment wholesale.
    matches = _lcs_match(old_hashes, [s["content_hash"] for s in new_segment_slots])
    matched_old_indexes = set()
    for new_index, slot in enumerate(new_segment_slots):
        if new_index in matches:
            old = old_segments[matches[new_index]]
            matched_old_indexes.add(matches[new_index])
            # Keep EVERYTHING from the old record (id, audio, generated
            # hash, provider, attempts...) -- only the chapter home and the
            # CURRENT pace are refreshed. Same text at a new pace keeps its
            # identity; the payload basis catches the pace change and
            # re-queues the audio (never a new segment ID).
            preserved = {**old, "chapter_id": slot["chapter_id"]}
            for attr in ("pace", "voice", "dialogue", "fragments", "internal_pauses"):
                if slot.get(attr):
                    preserved[attr] = slot[attr]
                else:
                    preserved.pop(attr, None)
            slot.clear()
            slot.update(preserved)
        else:
            slot["segment_id"] = _new_segment_id()

    # Old segments that matched nothing are superseded -- audio kept on
    # disk until cleanup, never silently deleted here.
    superseded = list((previous or {}).get("superseded", []))
    for old_index, old in enumerate(old_segments):
        if old_index not in matched_old_indexes and old.get("status") not in (None, "pending"):
            superseded.append({**old, "status": "superseded"})

    return {
        "version": SEGMENTS_VERSION,
        "chapters": new_chapters,
        "superseded": superseded,
    }


# ── Persistence ───────────────────────────────────────────────────────────────

def segments_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, "generated-segments", "segments.json")


def load_segments(workspace_path: str) -> dict | None:
    data, _readable = read_json(segments_path(workspace_path))
    return data if isinstance(data, dict) else None   # first run, or corrupt = rebuild


def save_segments(workspace_path: str, manifest: dict) -> None:
    # Atomic, for the same reason as the run record: this file is
    # rewritten after every generated segment, it is the biggest one in
    # the workspace, and half a dozen endpoints read it. A reader inside
    # the truncate window would conclude the book has no segments at all.
    write_json_atomic(segments_path(workspace_path), manifest)
