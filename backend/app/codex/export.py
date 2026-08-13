# codex/export.py -- getting the Weave out of the app
# ===================================================
# The spec is blunt about why this exists, and the audit found none of it built:
# a writer's world model has to be able to LEAVE. Markdown files already travel
# (copy the folder and the entries come with it), but the part the Weave adds --
# who is connected to whom and why, and what is true at which point in the book
# -- lived only in files that read as YAML frontmatter, or in an index that is
# explicitly a rebuildable cache.
#
# So there are three shapes here, and they are three different promises:
#
#   MARKDOWN  For a person. Their world as a document they can read, print, or
#             paste into a message to their editor. Chapter NAMES, not anchors.
#
#   JSON      For a program. The graph as it actually is, ids intact, so a
#             writer who outgrows this app or wants to build something on top of
#             it is not starting from a screen-scrape.
#
#   CSV       For a spreadsheet, which is where a lot of novelists actually keep
#             lists. Three tables rather than one nested file, because a nested
#             CSV is not a CSV.
#
# ONE RULE ACROSS ALL THREE, and it is R4.3: an anchor travels as its id AND as
# the chapter's name. The id is what survives a rename and what a program needs;
# the name is the only half a human can read. Exporting one without the other
# makes the file useless to somebody -- and which somebody depends on which half
# you dropped.

import csv
import io
import json
import os

from app.codex.anchors import BEFORE_STORY, AnchorIndex
from app.codex.threads import parse_thread
from app.codex.types_registry import TypesError, default_registry, load_registry
from app.utils.structure_store import ensure_chapter_ids, ordered_chapter_filenames


def _chapter_labels(project_path: str) -> dict[str, str]:
    """
    Anchor -> the name a writer would recognise: "3. The Letter".

    Built from the manuscript's real order, so it says what the writer sees in
    their sidebar rather than a position derived from a filename.
    """
    labels: dict[str, str] = {}
    try:
        ids = ensure_chapter_ids(project_path)
        ordered = [n for n in ordered_chapter_filenames(project_path) if n in ids]
    except Exception:
        return labels

    manuscript = os.path.join(project_path, "manuscript")
    for position, filename in enumerate(ordered, start=1):
        title = filename.removesuffix(".md")
        path = os.path.join(manuscript, filename)
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("# "):
                        title = line[2:].strip()
                        break
        except OSError:
            pass
        labels[ids[filename]] = f"{position}. {title}"
    return labels


def label_for_anchor(anchor: str | None, labels: dict[str, str]) -> str:
    """
    The human half of an anchor, or an honest blank.

    An anchor whose chapter has been deleted resolves to nothing, and saying so
    is better than printing a raw id into a document a person is meant to read.
    """
    if not anchor:
        return ""
    if anchor == BEFORE_STORY:
        return "before the story"
    return labels.get(anchor.split("/", 1)[0], "")


def read_world(project_path: str) -> dict:
    """
    Everything the Weave knows about this project, read from the FILES.

    Deliberately not from the index. app.db is documented as a rebuildable
    cache; an export is a promise about the writer's actual world, and reading
    the source of truth means an export cannot be wrong in a way a reindex would
    fix.
    """
    from app.codex.migrate import entries_home

    try:
        registry, _ = load_registry(project_path)
    except TypesError:
        registry = default_registry()

    root = os.path.join(project_path, entries_home(project_path))
    labels = _chapter_labels(project_path)

    entries: list[dict] = []
    for type_entry in registry.get("types", []):
        folder = os.path.join(root, type_entry.get("folder", ""))
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            try:
                with open(os.path.join(folder, name), "r", encoding="utf-8") as f:
                    thread = parse_thread(f.read(), registry)
            except OSError:
                continue
            thread["filename"] = name
            thread["kind_label"] = type_entry.get("label", type_entry["id"])
            entries.append(thread)

    names = {e.get("entity_id"): (e.get("display_name") or e.get("name") or "")
             for e in entries}
    return {"registry": registry, "entries": entries, "labels": labels,
            "names": names}


# ── Markdown: the world as a document ────────────────────────────────────────

def to_markdown(project_path: str, world: dict | None = None) -> str:
    world = world or read_world(project_path)
    labels, names = world["labels"], world["names"]
    lines: list[str] = ["# The Weave", ""]

    entries = world["entries"]
    if not entries:
        lines.append("This world has no entries yet.")
        return "\n".join(lines) + "\n"

    by_kind: dict[str, list[dict]] = {}
    for entry in entries:
        by_kind.setdefault(entry.get("kind_label", "Entries"), []).append(entry)

    for kind, group in by_kind.items():
        lines += [f"## {kind}", ""]
        for entry in group:
            name = entry.get("display_name") or entry.get("name") or "(unnamed)"
            lines.append(f"### {name}")
            if entry.get("display_name") and entry.get("name") != entry["display_name"]:
                lines.append(f"*Also written as {entry['name']}.*")
            if entry.get("aliases"):
                lines.append(f"*Also called: {', '.join(entry['aliases'])}.*")
            lines.append("")

            ties = entry.get("ties") or []
            if ties:
                lines.append("**Connections**")
                lines.append("")
                for tie in ties:
                    other = names.get(tie.get("target"), tie.get("target", ""))
                    relation = str(tie.get("rel") or "connected to").replace("_", " ")
                    line = f"- {relation} **{other}**"
                    when = label_for_anchor(tie.get("at"), labels)
                    if when:
                        line += f" (from {when})"
                    lines.append(line)
                    # THE REASON, which is the half worth reading. A connection
                    # exported without it is a diagram; with it, it is the story.
                    if tie.get("reason"):
                        lines.append(f"  - {tie['reason']}")
                lines.append("")

            run = entry.get("run") or []
            if run:
                lines.append("**How this changes through the story**")
                lines.append("")
                for fact in run:
                    when = label_for_anchor(fact.get("at"), labels) or "not placed yet"
                    line = f"- {when}: {fact.get('value', '')}"
                    frame = fact.get("frame")
                    if frame and frame != "truth":
                        line += f" (only {names.get(frame, frame)} thinks this)"
                    reveal = label_for_anchor(fact.get("revealed_at"), labels)
                    if reveal:
                        line += f" -- the reader learns this at {reveal}"
                    lines.append(line)
                lines.append("")

            for section in (entry.get("sections") or {}).values():
                content = str(section.get("content") or "").strip()
                blocks = section.get("trait_blocks") or []
                if not content and not blocks:
                    continue
                lines.append(f"**{section.get('heading', '')}**")
                lines.append("")
                if content:
                    lines += [content, ""]
                for block in blocks:
                    mark = " (never named)" if block.get("subtext") else ""
                    lines.append(
                        f"- {block.get('trait', '')} [{block.get('importance', '')}"
                        f"{mark}]: {block.get('description', '')}")
                if blocks:
                    lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# ── JSON: the graph as it is ─────────────────────────────────────────────────

def to_json(project_path: str, world: dict | None = None) -> str:
    world = world or read_world(project_path)
    labels, names = world["labels"], world["names"]

    entries = []
    connections = []
    facts = []
    for entry in world["entries"]:
        entity_id = entry.get("entity_id", "")
        entries.append({
            "entity_id": entity_id,
            "type": entry.get("type", ""),
            "kind_label": entry.get("kind_label", ""),
            "name": entry.get("name", ""),
            "display_name": entry.get("display_name", ""),
            "aliases": entry.get("aliases", []),
            "filename": entry.get("filename", ""),
            "sections": entry.get("sections", {}),
        })
        for tie in entry.get("ties") or []:
            connections.append({
                "from": entity_id,
                "from_name": names.get(entity_id, ""),
                "to": tie.get("target", ""),
                "to_name": names.get(tie.get("target"), ""),
                "relation": tie.get("rel", ""),
                "reason": tie.get("reason", ""),
                # Both halves, always: the id survives a rename, the label is
                # the only part a person can read.
                "at": tie.get("at") or "",
                "at_label": label_for_anchor(tie.get("at"), labels),
                "until": tie.get("until") or "",
                "until_label": label_for_anchor(tie.get("until"), labels),
            })
        for fact in entry.get("run") or []:
            facts.append({
                "entity_id": entity_id,
                "entity_name": names.get(entity_id, ""),
                "fact_id": fact.get("id", ""),
                "axis": fact.get("axis", ""),
                "value": fact.get("value", ""),
                "frame": fact.get("frame", "truth"),
                "frame_name": names.get(fact.get("frame"), fact.get("frame", "")),
                "at": fact.get("at") or "",
                "at_label": label_for_anchor(fact.get("at"), labels),
                "revealed_at": fact.get("revealed_at") or "",
                "revealed_at_label": label_for_anchor(fact.get("revealed_at"), labels),
            })

    return json.dumps({
        "format": "storythread-weave",
        "version": 1,
        "chapters": [{"anchor": anchor, "label": label}
                     for anchor, label in world["labels"].items()],
        "entries": entries,
        "connections": connections,
        "facts": facts,
    }, indent=2, ensure_ascii=False)


# ── CSV: three tables, because a nested CSV is not a CSV ─────────────────────

def to_csv_tables(project_path: str, world: dict | None = None) -> dict[str, str]:
    world = world or read_world(project_path)
    data = json.loads(to_json(project_path, world))

    def table(rows: list[dict], columns: list[str]) -> str:
        out = io.StringIO(newline="")
        writer = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore",
                                lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        return out.getvalue()

    return {
        "entries.csv": table(
            [{**e, "aliases": ", ".join(e["aliases"])} for e in data["entries"]],
            ["entity_id", "type", "kind_label", "name", "display_name",
             "aliases", "filename"]),
        "connections.csv": table(
            data["connections"],
            ["from", "from_name", "relation", "to", "to_name", "reason",
             "at", "at_label", "until", "until_label"]),
        "facts.csv": table(
            data["facts"],
            ["entity_id", "entity_name", "fact_id", "axis", "value", "frame",
             "frame_name", "at", "at_label", "revealed_at", "revealed_at_label"]),
    }


def anchors_are_labelled(project_path: str) -> bool:
    """Whether this project can label its anchors at all -- false for a project
    with no chapters, where an export is still valid but has nothing to say."""
    return bool(AnchorIndex.for_project(project_path)._chapter_pos)
