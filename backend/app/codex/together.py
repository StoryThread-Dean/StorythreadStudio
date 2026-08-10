"""
Who shares a scene with whom.

The Weave's most useful free signal, and the answer to a question the walk kept
asking badly. When it asks "how is Alexandra Langford connected to the story?"
it used to offer every other entry in the book in one flat alphabetical list --
which is no help at all, because the writer already knows Alexandra is connected
to SOMEONE and what they want is the short list of likely candidates.

The prose already contains that short list. If two names appear in the same
scene, over and over, the story is asserting a connection whether or not
anything records one. Counting that costs nothing and asks no model anything.

THE UNIT IS THE SCENE, NOT THE CHAPTER. That was a deliberate choice, and it
matters more than it sounds: in a chapter that cuts between two locations, a
chapter-level count would pair up characters who are never in the same room.
A scene is the smallest unit the app can name that a writer would agree is
"together".

Two things use what this module produces:

  1. The picker in the walk, ordered strongest-first, so the likely answer is
     near the top and says WHY it is near the top ("in 12 scenes with her").
  2. The Untied stop -- a pair the prose puts together repeatedly with nothing
     recorded between them.

What it deliberately does NOT do is decide what the connection IS. Sharing a
scene is evidence of a relationship, not of its kind: a knight and the dragon
he is trying to kill share a great many scenes. Naming the relation stays the
writer's call, and the walk asks rather than assumes.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.codex.mentions import (
    alias_display,
    build_alias_map,
    find_mentions,
)
from app.utils.scene_parser import split_into_scenes

__all__ = ["Together", "shared_scenes", "MIN_SHARED_SCENES"]


# HOW MANY SHARED SCENES BEFORE THE APP SAYS ANYTHING UNPROMPTED.
#
# One shared scene is not evidence of anything. Two strangers pass on a street
# once. This is the same lesson the Unspun pass learned the hard way -- a rule
# with no floor produced 177 junk entries and, in the writer's words, "makes
# this app look amateurish". So the floor applies to the STOP only.
#
# The picker has no floor, because there the writer is already asking the
# question and one shared scene is a genuinely useful thing to be shown.
MIN_SHARED_SCENES = 2


@dataclass
class Together:
    """Two entries the prose keeps putting in the same scene."""

    a: str                      # entity_id, lexicographically first
    b: str                      # entity_id, lexicographically second
    scenes: int = 0             # how many scenes name both
    first_chapter: str = ""     # where they first share one
    quote: str = ""             # a sentence from that first shared scene

    def other(self, entity_id: str) -> str:
        """The end that is not the one asked about."""
        return self.b if entity_id == self.a else self.a

    def touches(self, entity_id: str) -> bool:
        return entity_id in (self.a, self.b)


def shared_scenes(chapters: list[tuple[str, str]],
                  threads: list[dict]) -> list[Together]:
    """
    Every pair of entries named in the same scene, strongest pairing first.

    `chapters` is [(chapter id, prose)] in reading order -- the same list the
    scan already read for its other passes, passed in rather than re-read.

    Cost is the thing to watch here. Mention detection runs once per scene, and
    the pairing is quadratic in the number of entries NAMED IN THAT SCENE, not
    in the size of the world. A scene with six characters makes fifteen pairs;
    a world with six hundred entries makes none unless the prose names them.
    """
    if not threads or not chapters:
        return []

    alias_map = build_alias_map(threads)
    display = alias_display(threads)

    counts: dict[tuple[str, str], int] = {}
    first_seen: dict[tuple[str, str], tuple[str, str]] = {}

    for chapter_id, prose in chapters:
        # drop_preamble=False on purpose. The summary path drops a short
        # opening block as a chapter title or epigraph, which is right for
        # summarising and wrong here: a short first scene is still a scene,
        # and dropping it would quietly un-share it.
        for scene_text in split_into_scenes(prose, drop_preamble=False):
            present = _named_in(scene_text, alias_map, display)
            if len(present) < 2:
                continue
            ids = sorted(present)
            for i, a in enumerate(ids):
                for b in ids[i + 1:]:
                    pair = (a, b)
                    counts[pair] = counts.get(pair, 0) + 1
                    if pair not in first_seen:
                        # The evidence is a sentence from the scene that first
                        # put them together. A writer who cannot see the text
                        # a claim came from has to take it on faith, and this
                        # app does not ask for faith.
                        first_seen[pair] = (chapter_id,
                                            _opening_sentence(scene_text))

    together = [
        Together(a=a, b=b, scenes=n,
                 first_chapter=first_seen[(a, b)][0],
                 quote=first_seen[(a, b)][1])
        for (a, b), n in counts.items()
    ]
    # Strongest first, then alphabetical so the order never wobbles between
    # runs. A list that reshuffles itself teaches the writer to distrust it.
    together.sort(key=lambda t: (-t.scenes, t.a, t.b))
    return together


def _named_in(scene_text: str, alias_map: dict, display: dict) -> set[str]:
    """
    The entries this scene names, BOUND mentions only.

    An ambiguous mention is skipped rather than guessed at. Two characters
    called John, and a scene that says only "John", is not evidence that either
    of them was there -- and a wrong pairing here would show up in the walk as
    a confident suggestion about a relationship that does not exist.
    """
    found: set[str] = set()
    for mention in find_mentions(scene_text, alias_map, display=display):
        if mention.bound and mention.entity_id:
            found.add(mention.entity_id)
    return found


def _opening_sentence(scene_text: str, width: int = 160) -> str:
    """The first real sentence of a scene, trimmed to something quotable."""
    text = " ".join(scene_text.split())
    if len(text) <= width:
        return text
    cut = text[:width]
    # Prefer a word boundary over chopping a word in half.
    space = cut.rfind(" ")
    if space > width // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:") + "..."
