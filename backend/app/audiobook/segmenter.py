# audiobook/segmenter.py -- narration text -> generation segments.
# =================================================================
# Turns the parsed narration (markers.py's chapters + elements) into the
# ordered list of SEGMENTS that speech providers will actually receive,
# plus the silence items between them. Spec sections 23 and 23.1.
#
# The two rules that make this file matter:
#
# 1. SIZE: paragraph-level segments targeting 800-1,500 characters.
#    Consecutive paragraphs group together until the cap; a single
#    paragraph over the cap falls back to sentence splits. Fewer requests,
#    better prosody, fewer audible joins than sentence-level segmentation.
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
import json
import os
import re
import uuid

from app.audiobook.markers import ParsedNarration

SEGMENTS_VERSION = 1

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
    as hard segment boundaries (they are CUT POINTS, spec 10.3).
    """
    items: list[dict] = []
    pending_paragraphs: list[str] = []
    pending_len = 0
    pending_pace = 1.0
    pending_dialogue = False
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

    def flush() -> None:
        nonlocal pending_paragraphs, pending_len
        if pending_paragraphs:
            text = "\n\n".join(pending_paragraphs)
            pending_paragraphs = []
            pending_len = 0
            # Never synthesize a fragment with no words in it. A pace span
            # opening just inside a quote leaves a lone '"' fragment, and
            # the engine renders bare punctuation as a breath-like false
            # start (live finding: an audible hiccup before dialogue).
            if not re.search(r"[A-Za-z0-9]", text):
                return
            item = {"kind": "segment_text", "text": text}
            if pending_pace != 1.0:
                item["pace"] = pending_pace
            if pending_dialogue:
                item["dialogue"] = True
            items.append(item)

    for element in elements:
        etype = element.get("type")
        if etype == "text":
            # A pace change is a hard boundary -- one segment, one speed.
            pace = element.get("pace", 1.0)
            if pace != pending_pace:
                flush()
                pending_pace = pace
            # Paragraphs group until the cap; oversize paragraphs split.
            # A dialogue/narration change is ALSO a boundary, so the
            # book-level Dialogue Pace can act on dialogue segments alone.
            for paragraph in element["content"].split("\n\n"):
                paragraph = paragraph.strip()
                if not paragraph:
                    continue
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
                if raw.get("dialogue"):
                    segment["dialogue"] = True
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
            for attr in ("pace", "dialogue"):
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
    try:
        with open(segments_path(workspace_path), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None                          # first run, or corrupt = rebuild


def save_segments(workspace_path: str, manifest: dict) -> None:
    os.makedirs(os.path.dirname(segments_path(workspace_path)), exist_ok=True)
    with open(segments_path(workspace_path), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
