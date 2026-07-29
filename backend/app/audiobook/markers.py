# audiobook/markers.py -- narration markers: text is the source of truth.
# ========================================================================
# The narration copy (narration-copy.md) is a plain Markdown file the
# writer can open in ANY editor. Markers live inline as a strict syntax:
#
#   [pause:0.8]              explicit pause, seconds
#   [scene-break]            configured scene-break silence
#   [chapter-break]          configured chapter-break silence
#   [exclude] ... [/exclude] text kept in the file but never narrated
#
# narration-structure.json is DERIVED by parsing this file -- the same
# filing-cabinet principle as the rest of Storythread: Markdown is truth,
# structured data is an index card that can always be rebuilt.
#
# Spec note that matters later: markers are segment CUT POINTS only. The
# silence itself is generated at assembly time by FFmpeg (free, exact,
# retunable without regenerating speech), which is also why pause DURATIONS
# stay out of the segment hashes in the generation stage.

import re
from dataclasses import dataclass, field

STRUCTURE_VERSION = 1

# One regex finds every marker; the pause duration is captured when present.
# Case-insensitive so hand-typed [Pause:0.8] still works.
_MARKER_RE = re.compile(
    r"\[(?:(pause)\s*:\s*([^\]]*)|(scene-break)|(chapter-break))\]",
    re.IGNORECASE,
)
_EXCLUDE_RE = re.compile(
    r"\[exclude\](.*?)\[/exclude\]",
    re.IGNORECASE | re.DOTALL,
)
_EXCLUDE_OPEN_RE = re.compile(r"\[exclude\]", re.IGNORECASE)

# Pace spans: [pace:0.85]...[/pace] narrates its contents at a different
# speed -- slower to let a scene breathe, faster to carry an action beat.
# Universal by construction: the local engine takes speed natively, cloud
# engines either do too or get time-stretched at assembly.
_PACE_RE = re.compile(r"\[pace:([^\]]*)\](.*?)\[/pace\]", re.IGNORECASE | re.DOTALL)
_PACE_OPEN_RE = re.compile(r"\[pace:([^\]]*)\]", re.IGNORECASE)
_PACE_CLOSE_RE = re.compile(r"\[/pace\]", re.IGNORECASE)

PACE_MIN, PACE_MAX = 0.5, 2.0


@dataclass
class ParsedChapter:
    title: str
    elements: list[dict] = field(default_factory=list)


@dataclass
class ParsedNarration:
    chapters: list[ParsedChapter] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_structure(self) -> dict:
        """The JSON shape written to narration-structure.json."""
        return {
            "version": STRUCTURE_VERSION,
            "chapters": [
                {"title": c.title, "elements": c.elements} for c in self.chapters
            ],
            "warnings": self.warnings,
        }


def split_chapters(narration_text: str) -> list[tuple[str, str]]:
    """
    Split the narration copy into (title, body) pairs on '# ' headings --
    h1 ONLY, so '## scene notes' or '#hashtag' in prose never splits a
    chapter. Text before the first heading becomes an untitled preamble
    chapter (shouldn't normally exist; import always writes headings).
    """
    lines = narration_text.split("\n")
    heading_idxs = [i for i, line in enumerate(lines) if line.startswith("# ")]
    if not heading_idxs:
        return [("Chapter 1", narration_text)]

    chapters: list[tuple[str, str]] = []
    preamble = "\n".join(lines[: heading_idxs[0]]).strip("\n")
    if preamble:
        chapters.append(("Front Matter", preamble))
    for n, start in enumerate(heading_idxs):
        end = heading_idxs[n + 1] if n + 1 < len(heading_idxs) else len(lines)
        title = lines[start][2:].strip() or "Untitled Chapter"
        body = "\n".join(lines[start + 1 : end]).strip("\n")
        chapters.append((title, body))
    return chapters


def _parse_body(body: str, warnings: list[str], chapter_title: str) -> list[dict]:
    """One chapter body -> ordered elements (text / pause / breaks / excluded)."""
    elements: list[dict] = []

    # 1. Lift [exclude]...[/exclude] blocks out first, recording them as
    #    excluded elements so the writer can see what won't be narrated.
    #    An unclosed [exclude] swallows to end-of-chapter -- flagged, because
    #    silently narrating "excluded" text would be worse.
    def _record_exclude(match: re.Match) -> str:
        content = match.group(1).strip()
        if content:
            elements_holder.append({"type": "excluded", "content": content})
        return "\x00EXCL\x00"       # placeholder keeps marker positions stable

    elements_holder: list[dict] = []
    body_wo_excludes = _EXCLUDE_RE.sub(_record_exclude, body)

    # An unclosed [exclude] swallows to end-of-chapter. Its element can't
    # ride the placeholder mechanism (the tail is cut off, so there is no
    # placeholder for it) -- it is appended at the very end instead, which
    # is also where it belongs in reading order.
    tail_excluded: dict | None = None
    open_leftover = _EXCLUDE_OPEN_RE.search(body_wo_excludes)
    if open_leftover:
        warnings.append(
            f"Chapter '{chapter_title}': an [exclude] has no closing [/exclude]; "
            "everything after it is excluded from narration."
        )
        cut = open_leftover.start()
        tail = body_wo_excludes[cut:]
        tail_text = _EXCLUDE_OPEN_RE.sub("", tail, count=1).strip()
        if tail_text:
            tail_excluded = {"type": "excluded", "content": tail_text}
        body_wo_excludes = body_wo_excludes[:cut]

    # 2. Split into pace regions: text inside [pace:X]...[/pace] carries a
    #    speed; everything else runs at 1.0. Regions are processed in
    #    order, so the exclude placeholders' iterator stays in sync.
    regions = _pace_regions(body_wo_excludes, warnings, chapter_title)

    # 3. Walk each region's text, splitting at the remaining markers. The
    #    placeholder marks where an excluded block sat; its element is
    #    emitted at that spot so reading order is preserved.
    pending_excludes = iter(elements_holder)

    def _flush_with_excludes(chunk: str, pace: float) -> None:
        pieces = chunk.split("\x00EXCL\x00")
        for i, piece in enumerate(pieces):
            text = piece.strip()
            if text:
                element = {"type": "text", "content": text}
                if pace != 1.0:
                    element["pace"] = pace
                elements.append(element)
            if i < len(pieces) - 1:
                try:
                    elements.append(next(pending_excludes))
                except StopIteration:
                    pass

    for pace, region in regions:
        pos = 0
        for match in _MARKER_RE.finditer(region):
            _flush_with_excludes(region[pos : match.start()], pace)
            pos = match.end()
            if match.group(1):                   # pause with duration
                raw = (match.group(2) or "").strip()
                try:
                    seconds = float(raw)
                    if not (0 < seconds <= 60):
                        raise ValueError
                    elements.append({"type": "pause", "duration_ms": int(round(seconds * 1000))})
                except ValueError:
                    warnings.append(
                        f"Chapter '{chapter_title}': [pause:{raw}] is not a valid duration "
                        "(use seconds, e.g. [pause:0.8]); the marker was ignored."
                    )
            elif match.group(3):
                elements.append({"type": "scene_break"})
            else:
                elements.append({"type": "chapter_break"})
        _flush_with_excludes(region[pos:], pace)

    if tail_excluded is not None:
        elements.append(tail_excluded)
    return elements


def _parse_pace_value(raw: str, warnings: list[str], chapter_title: str) -> float:
    try:
        pace = float(raw.strip())
        if not (PACE_MIN <= pace <= PACE_MAX):
            raise ValueError
        return pace
    except ValueError:
        warnings.append(
            f"Chapter '{chapter_title}': [pace:{raw.strip()}] is not a valid pace "
            f"(use {PACE_MIN} to {PACE_MAX}, e.g. [pace:0.85]); normal pace was used."
        )
        return 1.0


def _pace_regions(body: str, warnings: list[str], chapter_title: str) -> list[tuple[float, str]]:
    """Split a chapter body into (pace, chunk) runs, in reading order.
    Nested pace spans are not supported (warned, inner opener dropped);
    an unclosed [pace:...] applies to the rest of the chapter (warned)."""
    regions: list[tuple[float, str]] = []
    pos = 0
    for match in _PACE_RE.finditer(body):
        if match.start() > pos:
            regions.append((1.0, body[pos:match.start()]))
        pace = _parse_pace_value(match.group(1), warnings, chapter_title)
        inner = match.group(2)
        if _PACE_OPEN_RE.search(inner):
            warnings.append(
                f"Chapter '{chapter_title}': pace markers cannot nest; the inner "
                "[pace:...] was ignored."
            )
            inner = _PACE_OPEN_RE.sub("", inner)
        regions.append((pace, inner))
        pos = match.end()

    tail = body[pos:]
    leftover = _PACE_OPEN_RE.search(tail)
    if leftover:
        warnings.append(
            f"Chapter '{chapter_title}': a [pace:...] has no closing [/pace]; "
            "it applies to the rest of the chapter."
        )
        before = tail[: leftover.start()]
        if before.strip():
            regions.append((1.0, _PACE_CLOSE_RE.sub("", before)))
        pace = _parse_pace_value(leftover.group(1), warnings, chapter_title)
        regions.append((pace, _PACE_CLOSE_RE.sub("", tail[leftover.end():])))
    elif tail.strip():
        # Stray closers with no opener are dropped silently -- harmless.
        regions.append((1.0, _PACE_CLOSE_RE.sub("", tail)))
    return regions


def parse_narration(narration_text: str) -> ParsedNarration:
    """Full parse: narration copy text -> chapters of ordered elements."""
    parsed = ParsedNarration()
    for title, body in split_chapters(narration_text):
        chapter = ParsedChapter(title=title)
        chapter.elements = _parse_body(body, parsed.warnings, title)
        parsed.chapters.append(chapter)
    return parsed
