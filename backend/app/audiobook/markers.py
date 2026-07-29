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

    # 2. Walk the remaining text, splitting at markers. The placeholder
    #    marks where an excluded block sat; its element is emitted at that
    #    spot so reading order is preserved.
    pos = 0
    pending_excludes = iter(elements_holder)

    def _flush_with_excludes(chunk: str) -> None:
        pieces = chunk.split("\x00EXCL\x00")
        for i, piece in enumerate(pieces):
            text = piece.strip()
            if text:
                elements.append({"type": "text", "content": text})
            if i < len(pieces) - 1:
                try:
                    elements.append(next(pending_excludes))
                except StopIteration:
                    pass

    for match in _MARKER_RE.finditer(body_wo_excludes):
        _flush_with_excludes(body_wo_excludes[pos : match.start()])
        pos = match.end()
        if match.group(1):                       # pause with duration
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

    _flush_with_excludes(body_wo_excludes[pos:])
    if tail_excluded is not None:
        elements.append(tail_excluded)
    return elements


def parse_narration(narration_text: str) -> ParsedNarration:
    """Full parse: narration copy text -> chapters of ordered elements."""
    parsed = ParsedNarration()
    for title, body in split_chapters(narration_text):
        chapter = ParsedChapter(title=title)
        chapter.elements = _parse_body(body, parsed.warnings, title)
        parsed.chapters.append(chapter)
    return parsed
