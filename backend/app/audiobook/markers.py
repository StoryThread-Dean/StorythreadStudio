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

# Pace spans narrate their contents at a different speed -- slower to let
# a scene breathe, faster to carry an action beat. Two value forms:
#
#   [pace:+2]...[/pace]   STEP form (what the toolbar inserts): N steps of
#                         0.05 up or down from the book's base pace, so a
#                         span always lands on a speed the engine renders
#                         cleanly. Capped to the proven 0.8-1.2 band at
#                         synthesis time -- stacking steps can never go
#                         "well past the bar" into S-L-O-W or chipmunk.
#                         The SIGN is what marks a step.
#   [pace:0.85]...[/pace] legacy MULTIPLIER form: base times the number,
#                         snapped to the 0.05 grid. Still parsed so
#                         narration files written before the step form
#                         keep their meaning.
#
# Universal by construction: the local engine takes speed natively, cloud
# engines either do too or get time-stretched at assembly.
_PACE_RE = re.compile(r"\[pace:([^\]]*)\](.*?)\[/pace\]", re.IGNORECASE | re.DOTALL)
_PACE_OPEN_RE = re.compile(r"\[pace:([^\]]*)\]", re.IGNORECASE)
_PACE_CLOSE_RE = re.compile(r"\[/pace\]", re.IGNORECASE)

PACE_MIN, PACE_MAX = 0.5, 2.0

# Voice spans narrate their contents as somebody else -- the third
# universal span marker, after pace (and before volume). One paragraph of
# dialogue read by Elena's voice, the rest of the book by the narrator:
#
#   [voice:Elena]"This cannot continue," she said.[/voice]
#
# The span carries a NAME, not a voice id. Names are what the writer
# thinks in, they survive recasting (change Elena's voice once in the
# cast and every one of her lines re-renders), and a narration copy full
# of "af_heart" would be unreadable in the plain-text editor this whole
# format exists to stay compatible with.
#
# Universal by construction in the same sense as pace: every engine takes
# a voice id, so a voice span means the same thing everywhere. What is
# NOT universal is mixing engines -- one run, one engine, many voices.
_VOICE_RE = re.compile(r"\[voice:([^\]]*)\](.*?)\[/voice\]", re.IGNORECASE | re.DOTALL)
_VOICE_OPEN_RE = re.compile(r"\[voice:([^\]]*)\]", re.IGNORECASE)
_VOICE_CLOSE_RE = re.compile(r"\[/voice\]", re.IGNORECASE)

# The cast always contains this one, it can never be deleted, and it is
# what an unknown or unset speaker falls back to.
NARRATOR = "Narrator"

# [say:SPOKEN]written[/say]. The authority on this lives in
# pronunciation.py, which owns what a spoken form MEANS; this copy exists
# only so markers.py can dissolve the wrapper without importing it.
_SAY_SPAN_RE = re.compile(r"\[say:[^\]]+\](.*?)\[/say\]",
                          re.IGNORECASE | re.DOTALL)
_SAY_OPEN_RE = re.compile(r"\[say:[^\]]*\]", re.IGNORECASE)
_SAY_CLOSE_RE = re.compile(r"\[/say\]", re.IGNORECASE)


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

    # 2. Split into VOICE regions first, then pace regions inside each.
    #    Voice is the outer span deliberately: a character's line may
    #    change speed within it, but a pace change never changes who is
    #    speaking. Regions are processed in order, so the exclude
    #    placeholders' iterator stays in sync.
    regions: list[tuple[float | str, str, str]] = []
    for voice, voice_chunk in _voice_regions(body_wo_excludes, warnings, chapter_title):
        for pace, chunk in _pace_regions(voice_chunk, warnings, chapter_title):
            regions.append((pace, voice, chunk))

    # 3. Walk each region's text, splitting at the remaining markers. The
    #    placeholder marks where an excluded block sat; its element is
    #    emitted at that spot so reading order is preserved.
    pending_excludes = iter(elements_holder)

    def _flush_with_excludes(chunk: str, pace: float | str, voice: str) -> None:
        pieces = chunk.split("\x00EXCL\x00")
        for i, piece in enumerate(pieces):
            text = piece.strip()
            if text:
                element = {"type": "text", "content": text}
                if pace != 1.0:
                    element["pace"] = pace
                if voice:
                    element["voice"] = voice
                elements.append(element)
            if i < len(pieces) - 1:
                try:
                    elements.append(next(pending_excludes))
                except StopIteration:
                    pass

    for pace, voice, region in regions:
        pos = 0
        for match in _MARKER_RE.finditer(region):
            before_chunk = region[pos : match.start()]
            _flush_with_excludes(before_chunk, pace, voice)
            pos = match.end()
            if match.group(1):                   # pause with duration
                raw = (match.group(2) or "").strip()
                try:
                    seconds = float(raw)
                    if not (0 < seconds <= 60):
                        raise ValueError
                    pause: dict = {"type": "pause", "duration_ms": int(round(seconds * 1000))}
                    # A pause with prose (not a paragraph break) on BOTH
                    # sides sits mid-paragraph: it splits a sentence run,
                    # not two paragraphs. The segmenter synthesizes such
                    # runs continuously (flow groups) because isolated
                    # fragment synthesis manufactures utterance endings
                    # (see flow.py).
                    after_probe = region[match.end() : match.end() + 24]
                    if (before_chunk.strip()
                            and not before_chunk.rstrip(" \t").endswith("\n")
                            and after_probe.strip()
                            and not after_probe.lstrip(" \t").startswith("\n")):
                        pause["mid_paragraph"] = True
                    elements.append(pause)
                except ValueError:
                    warnings.append(
                        f"Chapter '{chapter_title}': [pause:{raw}] is not a valid duration "
                        "(use seconds, e.g. [pause:0.8]); the marker was ignored."
                    )
            elif match.group(3):
                elements.append({"type": "scene_break"})
            else:
                elements.append({"type": "chapter_break"})
        _flush_with_excludes(region[pos:], pace, voice)

    if tail_excluded is not None:
        elements.append(tail_excluded)
    return elements


def _parse_pace_value(raw: str, warnings: list[str], chapter_title: str) -> float | str:
    """A pace value is either a signed STEP count ('+2', '-1') or a bare
    legacy multiplier ('0.85'). Steps come back as a normalized signed
    string so downstream code can tell the two forms apart; multipliers
    stay floats. Either way, 1.0 means 'no change'."""
    value = raw.strip()
    if value[:1] in ("+", "-"):
        try:
            steps = int(value)
        except ValueError:
            warnings.append(
                f"Chapter '{chapter_title}': [pace:{value}] is not a valid pace "
                "(use whole steps like [pace:+2] or [pace:-1]); normal pace was used."
            )
            return 1.0
        # +0/-0 is an explicit "no change" -- treated as unmarked text.
        return f"{steps:+d}" if steps else 1.0
    try:
        pace = float(value)
        if not (PACE_MIN <= pace <= PACE_MAX):
            raise ValueError
        return pace
    except ValueError:
        warnings.append(
            f"Chapter '{chapter_title}': [pace:{value}] is not a valid pace "
            f"(use steps like [pace:+2] or [pace:-1], or a multiplier "
            f"{PACE_MIN} to {PACE_MAX}); normal pace was used."
        )
        return 1.0


def _voice_regions(body: str, warnings: list[str],
                   chapter_title: str) -> list[tuple[str, str]]:
    """Split a chapter body into (voice name, chunk) runs, in reading
    order. "" means the narrator.

    The failure modes are the same three the pace splitter learned, and
    they matter more here: a passage silently read by the wrong character
    is worse than one read at the wrong speed, because the writer hears a
    stranger rather than a slightly-off tempo.
      - nested spans are not supported (warned, inner opener dropped)
      - an unclosed [voice:...] applies to the rest of the chapter (warned)
      - a stray [/voice] is dropped WITH a warning -- the classic cause is
        a preview selection that cut into a span, which would otherwise
        play in the narrator's voice with no explanation
    """

    def _drop_stray_closers(chunk: str) -> str:
        if _VOICE_CLOSE_RE.search(chunk):
            warnings.append(
                f"Chapter '{chapter_title}': a [/voice] has no opening "
                "[voice:...] and was ignored. If this is a preview, make sure "
                "the selection includes the [voice:...] tag -- otherwise the "
                "passage is read by the narrator."
            )
            return _VOICE_CLOSE_RE.sub("", chunk)
        return chunk

    def _clean_name(raw: str) -> str:
        name = " ".join(raw.split()).strip()
        if not name:
            warnings.append(
                f"Chapter '{chapter_title}': a [voice:] marker has no name; "
                "the narrator was used."
            )
        return name

    regions: list[tuple[str, str]] = []
    pos = 0
    for match in _VOICE_RE.finditer(body):
        if match.start() > pos:
            regions.append(("", _drop_stray_closers(body[pos:match.start()])))
        inner = match.group(2)
        if _VOICE_OPEN_RE.search(inner):
            warnings.append(
                f"Chapter '{chapter_title}': voice markers cannot nest; the "
                "inner [voice:...] was ignored."
            )
            inner = _VOICE_OPEN_RE.sub("", inner)
        regions.append((_clean_name(match.group(1)), inner))
        pos = match.end()

    tail = body[pos:]
    leftover = _VOICE_OPEN_RE.search(tail)
    if leftover:
        warnings.append(
            f"Chapter '{chapter_title}': a [voice:...] has no closing "
            "[/voice]; it applies to the rest of the chapter."
        )
        before = tail[: leftover.start()]
        if before.strip():
            regions.append(("", _drop_stray_closers(before)))
        regions.append((_clean_name(leftover.group(1)),
                        _drop_stray_closers(tail[leftover.end():])))
    elif tail.strip() or not regions:
        regions.append(("", _drop_stray_closers(tail)))
    return regions


def speaker_names(narration_text: str) -> list[str]:
    """Every distinct name used in a [voice:...] span, in first-use order.

    Used to tell the writer which names their manuscript expects, so the
    cast screen can offer to add the ones that are missing rather than
    making them retype what they already wrote.
    """
    seen: list[str] = []
    for match in _VOICE_OPEN_RE.finditer(narration_text):
        name = " ".join(match.group(1).split()).strip()
        if name and not any(name.lower() == s.lower() for s in seen):
            seen.append(name)
    return seen


def _pace_regions(body: str, warnings: list[str],
                  chapter_title: str) -> list[tuple[float | str, str]]:
    """Split a chapter body into (pace, chunk) runs, in reading order.
    Nested pace spans are not supported (warned, inner opener dropped);
    an unclosed [pace:...] applies to the rest of the chapter (warned);
    a [/pace] with no opener is dropped WITH a warning -- the classic
    cause is a preview selection that cut into a span, which would
    otherwise silently play at normal pace."""

    def _drop_stray_closers(chunk: str) -> str:
        # Never let a stray closer reach the engine as narrated text.
        if _PACE_CLOSE_RE.search(chunk):
            warnings.append(
                f"Chapter '{chapter_title}': a [/pace] has no opening [pace:...] "
                "and was ignored. If this is a preview, make sure the selection "
                "includes the [pace:...] tag -- otherwise the passage plays at "
                "normal pace."
            )
            return _PACE_CLOSE_RE.sub("", chunk)
        return chunk

    regions: list[tuple[float | str, str]] = []
    pos = 0
    for match in _PACE_RE.finditer(body):
        if match.start() > pos:
            regions.append((1.0, _drop_stray_closers(body[pos:match.start()])))
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
            regions.append((1.0, _drop_stray_closers(before)))
        pace = _parse_pace_value(leftover.group(1), warnings, chapter_title)
        regions.append((pace, _drop_stray_closers(tail[leftover.end():])))
    elif tail.strip():
        regions.append((1.0, _drop_stray_closers(tail)))
    return regions


def strip_all_markers(text: str) -> str:
    """
    Every narration marker dissolved, every word kept.

    Wrappers give up their contents ([say:X]word[/say] -> word,
    [voice:N]"line"[/voice] -> "line"); standalone markers vanish. Used
    by Dialogue Check, which reads a passage from the WRITING editor
    where markers have no business being honoured -- treating a stray
    [pause:0.8] as a real pause there would quietly turn a read-aloud
    into a narration rehearsal.
    """
    out = _SAY_SPAN_RE.sub(lambda m: m.group(1), text)
    out = _VOICE_RE.sub(lambda m: m.group(2), out)
    out = _PACE_RE.sub(lambda m: m.group(2), out)
    out = _EXCLUDE_RE.sub(lambda m: m.group(1), out)
    out = _MARKER_RE.sub("", out)
    # Unmatched halves last. A lone [/say] left by a selection that
    # clipped one is the commonest of these, and the engine reads it out
    # as "slash" -- markers must never be audible.
    for stray in (_SAY_OPEN_RE, _SAY_CLOSE_RE, _VOICE_OPEN_RE,
                  _VOICE_CLOSE_RE, _PACE_OPEN_RE, _PACE_CLOSE_RE,
                  _EXCLUDE_OPEN_RE):
        out = stray.sub("", out)
    return out


def parse_narration(narration_text: str) -> ParsedNarration:
    """Full parse: narration copy text -> chapters of ordered elements."""
    parsed = ParsedNarration()
    for title, body in split_chapters(narration_text):
        chapter = ParsedChapter(title=title)
        chapter.elements = _parse_body(body, parsed.warnings, title)
        parsed.chapters.append(chapter)
    return parsed
