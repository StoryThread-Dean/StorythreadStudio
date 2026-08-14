# codex/anchors.py -- where in the story something happened
# ==========================================================
# An ANCHOR is a point in the manuscript: a chapter, optionally narrowed to
# a scene inside it. Every fact in the Weave carries one, which is what lets
# the app answer "who is she as of chapter 7?" instead of treating a
# character as one unchanging description from page one to the last page.
#
# Anchors are stored as IDs, never as positions:
#
#     c-3f9c2e1b/s-7a1b2c3d        chapter 7, scene 3
#     c-3f9c2e1b                   chapter 7, no scene given
#
# Positions would be a trap. "Chapter 7" written as `7` breaks the moment
# the writer inserts a prologue, and every fact in the book would silently
# shift one chapter later with nothing to show for it. IDs survive renames,
# reorders and insertions because they never encode position in the first
# place. The human-readable form ("Chapter 7, Scene 3") is rendered for
# display and written as a trailing comment in the Markdown, but the ID is
# what is authoritative.
#
# ORDINALS ARE COMPUTED, NEVER STORED. Comparing two anchors means asking
# the project's current reading order where each one sits. Storing a number
# would freeze an ordering that the writer is free to change at any time --
# the ordering authority stays structure_store.ordered_chapter_filenames(),
# exactly as it is for the sidebar, Reader Mode and exports.

import json
import os
from dataclasses import dataclass

from app.utils.structure_store import ensure_chapter_ids, ordered_chapter_filenames

# A scene-less anchor sits at the START of its chapter. "As of chapter 7"
# reads as "by the time chapter 7 begins", so a fact anchored to the chapter
# is already true in its first scene. This also makes a degraded anchor --
# one whose scene was deleted -- behave conservatively: it stays true for
# the whole chapter rather than silently jumping to the end of it.
_CHAPTER_START = -1


@dataclass(frozen=True)
class Anchor:
    """A point in the story. `scene_id` is None for a whole-chapter anchor."""
    chapter_id: str
    scene_id: str | None = None

    def __str__(self) -> str:
        return format_anchor(self.chapter_id, self.scene_id)


# ── Before page one ──────────────────────────────────────────────────────────
#
# A position below every real chapter, and the anchor that names it.
#
# Kept HERE rather than in the resolver because everything that compares
# positions has to agree: resolution, spoiler visibility, the snag checkers and
# the scan. A second definition of "the beginning" is a second answer to "is this
# in force yet".
ALWAYS = (-1, -1)
BEFORE_STORY = "before"


def format_anchor(chapter_id: str, scene_id: str | None = None) -> str:
    """The stored form: 'c-xxx' or 'c-xxx/s-yyy'."""
    return f"{chapter_id}/{scene_id}" if scene_id else chapter_id


def parse_anchor(text: str) -> Anchor | None:
    """
    Read a stored anchor. Returns None for anything unparseable.

    None rather than raising: an anchor is writer-editable text inside a
    Markdown file, and one malformed line should degrade that single fact,
    not blow up the whole Thread.
    """
    if not isinstance(text, str):
        return None
    # Tolerate a trailing "# Chapter 7, Scene 3" comment, which is written
    # for human readers and carries no authority.
    cleaned = text.split("#", 1)[0].strip()
    if not cleaned:
        return None
    parts = [p.strip() for p in cleaned.split("/") if p.strip()]
    if not parts:
        return None
    chapter_id = parts[0]
    scene_id = parts[1] if len(parts) > 1 else None
    return Anchor(chapter_id, scene_id)


def _scene_order(folder_path: str) -> dict[str, list[str]]:
    """
    {chapter_id: [scene_id, ...]} in reading order, from manuscript/scenes.json.

    Absent or corrupt is a normal answer, not an error -- a project that has
    never had its scenes indexed simply has chapter-level anchors, which the
    whole design is built to tolerate.
    """
    path = os.path.join(folder_path, "manuscript", "scenes.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    order: dict[str, list[str]] = {}
    for chapter_id, scenes in (data.get("chapters") or {}).items():
        if not isinstance(scenes, list):
            continue
        order[chapter_id] = [
            s.get("id") for s in scenes
            if isinstance(s, dict) and s.get("id") and not s.get("tombstoned")
        ]
    return order


class AnchorIndex:
    """
    Turns anchors into comparable positions, for one project at one moment.

    Build it once per request and throw it away -- it is a snapshot of the
    current reading order, and the writer may reorder acts a second later.
    """

    def __init__(self, chapter_ids: list[str], scenes: dict[str, list[str]] | None = None):
        self._chapter_pos = {cid: i for i, cid in enumerate(chapter_ids)}
        self._scene_pos: dict[str, dict[str, int]] = {}
        for chapter_id, scene_ids in (scenes or {}).items():
            self._scene_pos[chapter_id] = {sid: i for i, sid in enumerate(scene_ids)}

    @classmethod
    def for_project(cls, folder_path: str) -> "AnchorIndex":
        ids = ensure_chapter_ids(folder_path)
        ordered = [ids[name] for name in ordered_chapter_filenames(folder_path) if name in ids]
        return cls(ordered, _scene_order(folder_path))

    def ordinal(self, anchor: Anchor | str | None) -> tuple[int, int] | None:
        """
        (chapter position, scene position) -- comparable with < and >.

        None means the anchor does not resolve here: its chapter was
        deleted, or it was never valid. Callers treat that as "unknown
        position" and must not guess, because guessing puts a fact somewhere
        it never happened.

        An anchor whose SCENE is gone but whose chapter remains degrades to
        the chapter rather than vanishing -- the design's stated fallback,
        and the reason a scene-less anchor is valid everywhere.

        BEFORE_STORY resolves to a position below every real one. It is not the
        same as an unwritten anchor and must not be confused with one: unwritten
        means "the writer has not said when", which the Weave reports as Unplaced
        and asks about. BEFORE_STORY means "true from before page one", which is
        a deliberate answer and the commonest one there is -- a character was
        orphaned, a war ended, a house was built. Pinning those to chapter one
        was the only option before, and it says something false: that the thing
        happened as the book opened.
        """
        if isinstance(anchor, str):
            if anchor.strip() == BEFORE_STORY:
                return ALWAYS
            anchor = parse_anchor(anchor)
        if anchor is None:
            return None

        chapter_pos = self._chapter_pos.get(anchor.chapter_id)
        if chapter_pos is None:
            return None
        if not anchor.scene_id:
            return (chapter_pos, _CHAPTER_START)

        scene_pos = self._scene_pos.get(anchor.chapter_id, {}).get(anchor.scene_id)
        if scene_pos is None:
            # Scene deleted or never indexed: fall back to the chapter.
            return (chapter_pos, _CHAPTER_START)
        return (chapter_pos, scene_pos)

    def knows_chapter(self, chapter_id: str) -> bool:
        return chapter_id in self._chapter_pos
