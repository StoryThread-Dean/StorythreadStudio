# outline_worksheet.py -- the Outline's header, and converting the old one
# =========================================================================
# The Outline is a second main editor: raw Markdown the writer types into.
# The only structure the app puts there is a short worksheet at the top --
# ten `Label: value` lines -- and the only two the app ever reads back are
# the word and chapter targets.
#
# See docs/outline-spec.md. The parts worth having in front of you here:
#
# THE EIGHT DESCRIPTIVE LINES ARE NOT A MASTER.
#   Title, Series, Genre, Tone, Description, Setting, Theme and Tense all live
#   in project.json and are injected into AI prompts from there. The worksheet
#   copies them ONCE, on request, and nothing ever reads them back. If that
#   ever changes, the app has two masters for eight fields and they will
#   drift. Only Target Word Count and Target Chapter Count are mastered here,
#   and neither exists in project.json.
#
# TARGETS ARE READ TOLERANTLY AND WRITTEN SURGICALLY.
#   Tolerantly, because the writer owns this file and will reformat it.
#   Surgically, because everything around the line is theirs.
#
# THE HEALER IS THE DANGEROUS PART. See heal_outline for the six properties it
# has to hold and the regression that dictated them.

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypedDict

import yaml

from app.utils.atomic import replace_atomic
from app.yaml_frontmatter import _FRONTMATTER_RE, parse_yaml_frontmatter

log = logging.getLogger(__name__)


# ── The worksheet ────────────────────────────────────────────────────────────

class OutlineMetadata(TypedDict, total=False):
    """What the app knows about a book when it writes the worksheet."""
    title:       str
    series_name: str
    genre:       str
    tone:        str
    description: str
    setting:     str
    theme:       str
    tense:       str


#: The ten labels, in the order they appear. ONE list, used by the renderer,
#: the "how much is filled in" count and the tests, so a field cannot be added
#: to the file without the gauge noticing it exists.
WORKSHEET_FIELDS: list[str] = [
    "Title",
    "Series",
    "Genre",
    "Tone",
    "Description",
    "Setting",
    "Theme",
    "Tense",
    "Target Word Count",
    "Target Chapter Count",
]

#: Which worksheet label each OutlineMetadata key fills.
_METADATA_TO_LABEL: dict[str, str] = {
    "title":       "Title",
    "series_name": "Series",
    "genre":       "Genre",
    "tone":        "Tone",
    "description": "Description",
    "setting":     "Setting",
    "theme":       "Theme",
    "tense":       "Tense",
}

#: Default word target per story type. Moved here from outline_templates.py,
#: which is being deleted; the numbers are unchanged and are midpoints of
#: common publishing ranges. Serial fiction has no fixed total -- a serial is
#: ongoing -- and the gauge renders a placeholder card for it instead of a
#: percentage.
STORY_TYPE_DEFAULT_WORDS: dict[str, int | None] = {
    "novel":          90000,
    "novella":        30000,
    "novelette":      13000,
    "short_story":    6000,
    "serial_fiction": None,
}


@dataclass(frozen=True)
class WorksheetTargets:
    """What the gauge and Book Details need out of the worksheet."""
    word_count:    int | None
    chapter_count: int | None
    #: How many of the ten labels have a value. Drives the Outline slice of
    #: the progress gauge, which used to be a yes/no on frontmatter existing.
    fields_filled: int
    #: True when a legacy YAML block supplied the word count. The file has not
    #: been converted; the number is still right.
    from_legacy:   bool = False


def _label_pattern(label: str) -> re.Pattern[str]:
    """
    Match one worksheet line, however the writer has reformatted it.

    Tolerates a bullet, bold markers, and any internal whitespace, because
    this is the writer's own file and they will tidy it. Deliberately does NOT
    tolerate alternate spellings of the label: one spelling, shipped and
    taught, so a value that fails to take effect is always visibly a typo
    rather than a mystery.
    """
    words = r"[ \t]+".join(re.escape(w) for w in label.split())
    # `prefix` is everything up to and including the colon, plus any bold
    # marker that closes AFTER it. Both spellings turn up in real files --
    # `**Label**: value` and `**Label:** value` -- and the setter re-emits
    # this group verbatim, so rewriting a value cannot eat the writer's
    # formatting on the way past.
    return re.compile(
        r"^(?P<prefix>[ \t]*(?:[-*+][ \t]+)?(?:\*\*|__)?[ \t]*"
        + words
        + r"[ \t]*(?:\*\*|__)?[ \t]*:(?:\*\*|__)?)(?P<value>.*)$",
        re.MULTILINE | re.IGNORECASE,
    )


#: Built once. Ten labels x every read is not expensive, but it is pointless.
_LABEL_PATTERNS: dict[str, re.Pattern[str]] = {
    label: _label_pattern(label) for label in WORKSHEET_FIELDS
}


def _read_label(text: str, label: str) -> str | None:
    """The raw value after a label, or None when the line is absent."""
    match = _LABEL_PATTERNS[label].search(text)
    if not match:
        return None
    return match.group("value").strip()


def _as_count(raw: str | None) -> int | None:
    """
    A worksheet number, or None.

    Commas are stripped, because 90,000 is how a person writes it. Anything
    non-numeric or non-positive is UNSET rather than zero: zero is a real
    target a writer could mean, and "I have not decided yet" is not zero.
    """
    if raw is None:
        return None
    cleaned = raw.replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return None
    try:
        value = int(cleaned)
    except ValueError:
        return None
    return value if value > 0 else None


def render_worksheet(
    metadata: OutlineMetadata | None,
    story_type: str = "novel",
) -> str:
    """
    The whole starting contents of notes/outline.md.

    No YAML, no HTML comment, no `---` rule, and no instruction prose. Every
    one of those was in the old template and every one of them was machinery
    or teaching sitting inside a document the writer owns. Teaching lives in
    the Explain panels; machinery is down to two readable lines.

    Target Word Count is pre-filled from the story type. Serial fiction leaves
    it BLANK rather than writing a zero or a null -- absence is how "no fixed
    total" is spelled in a file a person reads.
    """
    meta: OutlineMetadata = metadata or {}

    values: dict[str, str] = {label: "" for label in WORKSHEET_FIELDS}
    for key, label in _METADATA_TO_LABEL.items():
        raw = meta.get(key)  # type: ignore[literal-required]
        if isinstance(raw, str) and raw.strip():
            values[label] = raw.strip()

    default_words = STORY_TYPE_DEFAULT_WORDS.get(story_type, 90000)
    if default_words:
        values["Target Word Count"] = str(default_words)

    title = values["Title"]
    heading = f"# Outline -- {title}" if title else "# Outline"

    lines = [heading, ""]
    for label in WORKSHEET_FIELDS:
        value = values[label]
        lines.append(f"{label}: {value}" if value else f"{label}:")
    # Two blank lines: the writer starts typing here.
    lines.extend(["", ""])
    return "\n".join(lines)


def read_targets(text: str) -> WorksheetTargets:
    """
    Pull the two numbers and the filled-in count out of an outline.

    LEGACY FALLBACK, AND IT IS LOAD-BEARING. If no worksheet line is present,
    the old YAML `target_word_count` is read instead. That decouples "the
    gauge is correct" from "the file has been rewritten": a project that has
    not been opened since the upgrade, or whose conversion was refused because
    its YAML is malformed, still reports the right target. Nothing downstream
    has to know which era the file is from.
    """
    word_raw = _read_label(text, "Target Word Count")
    chapter_raw = _read_label(text, "Target Chapter Count")

    word = _as_count(word_raw)
    chapter = _as_count(chapter_raw)

    from_legacy = False
    if word is None and word_raw is None:
        legacy = parse_yaml_frontmatter(text).get("target_word_count")
        if isinstance(legacy, (int, float)) and legacy > 0:
            word = int(legacy)
            from_legacy = True

    filled = sum(
        1 for label in WORKSHEET_FIELDS if (_read_label(text, label) or "")
    )
    return WorksheetTargets(
        word_count=word,
        chapter_count=chapter,
        fields_filled=filled,
        from_legacy=from_legacy,
    )


def _outline_path(project_root: str) -> str:
    return os.path.join(project_root, "notes", "outline.md")


def _read_outline(project_root: str) -> str | None:
    path = _outline_path(project_root)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError as exc:
        log.warning("outline_worksheet: could not read outline.md: %s", exc)
        return None


def _write_outline(project_root: str, text: str) -> bool:
    """Atomic write, because a half-written outline is a lost outline."""
    path = _outline_path(project_root)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        replace_atomic(tmp, path)
    except OSError as exc:
        log.warning("outline_worksheet: could not write outline.md: %s", exc)
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False
    return True


def _set_label(text: str, label: str, value: str) -> str:
    """
    Replace one worksheet line's value, or insert the line if it is missing.

    Only the value moves. The writer's bullet, bold and spacing survive,
    because they chose them.
    """
    pattern = _LABEL_PATTERNS[label]
    match = pattern.search(text)
    if match:
        head = match.group("prefix")
        return text[: match.start()] + f"{head} {value}".rstrip() + text[match.end():]

    # Missing. Put it after the last worksheet line that IS present, so the
    # header stays a block rather than growing a stray line at the bottom.
    last_end = -1
    for other in WORKSHEET_FIELDS:
        m = _LABEL_PATTERNS[other].search(text)
        if m and m.end() > last_end:
            last_end = m.end()
    new_line = f"{label}: {value}".rstrip()
    if last_end >= 0:
        return text[:last_end] + "\n" + new_line + text[last_end:]

    # No worksheet at all. After the H1 if there is one, otherwise at the top.
    heading = re.search(r"^#[^\n]*$", text, re.MULTILINE)
    if heading:
        return text[: heading.end()] + "\n\n" + new_line + text[heading.end():]
    return new_line + "\n" + text


def _set_target(project_root: str, label: str, value: int) -> bool:
    """
    Shared body of the two target setters.

    HEALS FIRST, and that is not tidiness. Writing a worksheet line into a
    file that still has YAML frontmatter would leave two different numbers
    claiming to be the word target, and read_targets prefers the worksheet --
    so the writer would see their new number while a stale one sat above it,
    waiting to be read by anything that looked at the YAML.

    A missing outline.md is a soft failure. The writer is allowed to delete it.
    """
    heal_outline(project_root)

    text = _read_outline(project_root)
    if text is None:
        log.warning("outline_worksheet: no outline.md in %s", project_root)
        return False

    return _write_outline(project_root, _set_label(text, label, str(value)))


def set_target_word_count(project_root: str, value: int) -> bool:
    """Book Details writes the project word target through here."""
    return _set_target(project_root, "Target Word Count", value)


def set_target_chapter_count(project_root: str, value: int) -> bool:
    """Book Details writes the project chapter target through here."""
    return _set_target(project_root, "Target Chapter Count", value)


def read_project_targets(project_root: str) -> WorksheetTargets:
    """Targets for a project on disk. Empty when there is no outline."""
    text = _read_outline(project_root)
    if text is None:
        return WorksheetTargets(None, None, 0)
    return read_targets(text)


# ── Converting a pre-v2.0.2 outline ──────────────────────────────────────────

#: The opening line of the metadata comment the old templates wrote. Matched
#: exactly, so this only ever removes the APP's own block and never a comment
#: the writer happened to write.
_SEED_COMMENT_RE = re.compile(
    r"<!--\s*\nTREAT AS SEED METADATA.*?-->\s*",
    re.DOTALL,
)

#: The exact regression shape: a YAML close fused onto a heading.
_FUSED_RE = re.compile(r"^-{3,}#{2,}", re.MULTILINE)

_KEPT_LABELS: list[tuple[str, str]] = [
    ("expected_characters",    "Characters"),
    ("expected_locations",     "Locations"),
    ("expected_lore",          "Lore"),
    ("expected_relationships", "Relationships"),
]


@dataclass(frozen=True)
class HealResult:
    healed:   bool
    text:     str
    #: Where the pre-heal bytes were copied, when anything was written.
    snapshot: str | None = None
    #: Why nothing happened, for the log. Not shown to the writer.
    reason:   str = ""


def _kept_section(fm: dict[str, Any]) -> str:
    """
    The writer's typed lists, preserved as prose.

    Decision #3 dropped the expected_* INPUTS, not the writer's data. Somebody
    typed these names in; deleting them because the control that collected
    them is going away would be the app throwing away work it asked for.

    The labels are chrome the Weave's scan strips. The values are invented
    names and correctly reach the Unwoven pass as things the writer planned.
    """
    lines: list[str] = []
    for key, label in _KEPT_LABELS:
        raw = fm.get(key)
        if isinstance(raw, list):
            names = [str(v).strip() for v in raw if str(v).strip()]
            if names:
                lines.append(f"{label}: {', '.join(names)}")

    chapters = fm.get("chapters")
    if isinstance(chapters, list) and chapters:
        parts: list[str] = []
        for entry in chapters:
            if isinstance(entry, dict):
                title = str(entry.get("title", "")).strip()
                target = entry.get("word_target")
                if title and target:
                    parts.append(f"{title} ({target})")
                elif title:
                    parts.append(title)
        if parts:
            lines.append(f"Chapters: {', '.join(parts)}")

    if not lines:
        return ""
    return "\n## Kept from your old outline\n\n" + "\n".join(lines) + "\n"


def _body_lines(text: str) -> list[str]:
    """Non-blank lines, for the no-line-lost check."""
    return [ln.rstrip() for ln in text.split("\n") if ln.strip()]


def _is_plausible_seed_comment(span: str) -> bool:
    """
    Does this really look like the app's own seed-metadata comment?

    A GUARD ON THE GUARD, and the reason is worth stating plainly. The
    no-line-lost post-condition works by excusing the lines it EXPECTS to
    disappear -- the frontmatter, and this comment. So if the seed-comment
    regex ever over-matches, the post-condition excuses whatever it swallowed
    and cheerfully approves a heal that ate the writer's book.

    That is not hypothetical: the test that reinstates the bug found exactly
    this hole. Widening _SEED_COMMENT_RE to match everything made the healer
    delete the entire outline AND pass its own safety check, because the check
    had been told those lines were meant to go.

    So the span has to look like a small HTML comment before it is trusted.
    Anything else is treated as "not the seed comment", the lines are not
    excused, and the post-condition fires the way it should.
    """
    stripped = span.strip()
    return (
        stripped.startswith("<!--")
        and stripped.endswith("-->")
        and stripped.count("\n") <= 20
    )


def heal_outline(
    project_root: str,
    metadata: OutlineMetadata | None = None,
    story_type: str = "novel",
) -> HealResult:
    """
    Convert a pre-v2.0.2 outline: YAML block out, worksheet in, body untouched.

    HEALING IS SUBTRACTIVE. It removes the app's own machinery from the top of
    the file and puts a readable header in its place. The writer's outline
    body -- whatever template it started as -- is theirs and is carried
    through as one opaque slice. This is not re-templating, and the difference
    between that and this is the difference between a migration and data loss.

    THE SIX PROPERTIES, and why. The Planner corruption regression (see
    test_outline_sections.py) happened because the old code SPLIT the file
    into parts and rebuilt it: a section that failed to parse simply was not
    in the rebuilt output, and the next save wrote that absence to disk. So:

      1. A text transform, never parse-and-reconstruct. One region removed,
         one block inserted. There is no join of parts anywhere below.
      2. A no-line-lost post-condition, checked before writing. Every line
         outside the removed frontmatter must still be there, in order.
         On failure: abort, write nothing, log loudly.
      3. A fused-separator guard, against the exact `---##` shape.
      4. Idempotent -- a healed file heals to itself, byte for byte.
      5. Refuse when ambiguous. No frontmatter, or YAML that will not parse:
         do nothing. A malformed file the writer can see beats one the app
         quietly rewrote.
      6. Snapshot first, then write atomically.
    """
    text = _read_outline(project_root)
    if text is None:
        return HealResult(False, "", reason="no outline.md")

    # (5) Refuse when ambiguous -- nothing to convert.
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return HealResult(False, text, reason="no frontmatter")

    try:
        fm = yaml.safe_load(match.group("body"))
    except yaml.YAMLError as exc:
        log.warning("heal_outline: refusing, malformed YAML: %s", exc)
        return HealResult(False, text, reason="malformed yaml")
    if not isinstance(fm, dict):
        return HealResult(False, text, reason="frontmatter is not a mapping")

    # (1) A text transform. The body is one slice from here on.
    body = text[match.end():]
    body = _SEED_COMMENT_RE.sub("", body, count=1)

    meta: OutlineMetadata = dict(metadata or {})  # type: ignore[assignment]
    worksheet = render_worksheet(meta, story_type).rstrip("\n")

    legacy_words = fm.get("target_word_count")
    if isinstance(legacy_words, (int, float)) and legacy_words > 0:
        worksheet = _set_label(worksheet, "Target Word Count", str(int(legacy_words)))

    kept = _kept_section(fm)

    # The newline between the worksheet and the body is GUARANTEED here. Its
    # absence is what fused a YAML close onto a heading and started all of it.
    new_text = worksheet + "\n\n" + body.lstrip("\n")
    if kept:
        new_text = new_text.rstrip("\n") + "\n" + kept

    # (2) No line lost. The worksheet replaces the frontmatter and the seed
    # comment, so those are the only lines allowed to disappear.
    removed = set(_body_lines(match.group(0)))
    seed = _SEED_COMMENT_RE.search(text[match.end():])
    if seed and _is_plausible_seed_comment(seed.group(0)):
        removed |= set(_body_lines(seed.group(0)))

    before = [ln for ln in _body_lines(text) if ln not in removed]
    after = _body_lines(new_text)
    cursor = 0
    for line in before:
        try:
            cursor = after.index(line, cursor) + 1
        except ValueError:
            log.error(
                "heal_outline: ABORTING, line would be lost from %s: %r",
                project_root, line,
            )
            return HealResult(False, text, reason="post-condition failed")

    # (3) Never produce the regression shape.
    if _FUSED_RE.search(new_text):
        log.error("heal_outline: ABORTING, produced a fused separator")
        return HealResult(False, text, reason="fused separator")

    # (6) Snapshot, then write atomically.
    snapshot = _snapshot(project_root, text)
    if not _write_outline(project_root, new_text):
        return HealResult(False, text, reason="write failed")

    return HealResult(True, new_text, snapshot=snapshot)


def _snapshot(project_root: str, text: str) -> str | None:
    """
    Keep the pre-heal bytes.

    Same shape global replace already uses, for the same reason: the writer
    did not ask for this rewrite, so there has to be a way back to what they
    had. A failed snapshot does not stop the heal -- the post-conditions above
    are the real safety -- but it is logged.
    """
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    folder = os.path.join(
        project_root, ".storythread", "snapshots", "outline-heal", stamp, "notes",
    )
    try:
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "outline.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path
    except OSError as exc:
        log.warning("heal_outline: could not snapshot: %s", exc)
        return None


def write_worksheet(
    project_root: str,
    metadata: OutlineMetadata | None,
    story_type: str = "novel",
) -> None:
    """Write a brand-new outline. Used at project creation."""
    path = _outline_path(project_root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _write_outline(project_root, render_worksheet(metadata, story_type))


__all__ = [
    "OutlineMetadata", "WorksheetTargets", "HealResult",
    "WORKSHEET_FIELDS", "STORY_TYPE_DEFAULT_WORDS",
    "render_worksheet", "read_targets", "read_project_targets",
    "set_target_word_count", "set_target_chapter_count",
    "heal_outline", "write_worksheet",
]
