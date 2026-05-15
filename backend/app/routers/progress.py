# routers/progress.py -- Writing Progress aggregation endpoints
# ===============================================================
# Two endpoints power the left-panel gauge and daily tracker:
#
#   GET /api/progress/summary  -- "what percentage complete is this project?"
#                                 Combines manuscript word count, outline
#                                 status, profiles bucket, and notes status
#                                 into the 50/10/30/10 weighted gauge.
#
#   GET /api/progress/daily    -- "how am I doing today?"
#                                 Today's word count and task credit list,
#                                 plus a 7-day hit/miss sparkline against
#                                 the writer's configured skill-level target.
#
# Both endpoints are read-only -- writes happen elsewhere (see save hooks in
# documents.py and profiles.py for word_delta/task_credit; see ai.py for
# advisor_run).

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.outline_frontmatter import parse_outline_frontmatter
from app.outline_templates import TEMPLATE_DEFAULTS
from app.progress_store import count_words, local_date_for, open_db
from app.settings_store import get_rollover_hour, load_settings


router = APIRouter(prefix="/api/progress", tags=["progress"])


# ── Skill-level targets ──────────────────────────────────────────────────────
#
# Maps the writer's chosen skill level (set in Settings) to a daily word target
# and a daily task-credit target. The seven steps are the user-facing labels;
# the gauge uses these exact values when checking "did I hit my goal today?"

SKILL_TARGETS: dict[str, tuple[int, int]] = {
    "newbie":       (500,    1),
    "beginner":     (750,    1),
    "novice":       (1_250,  2),
    "amateur":      (2_500,  2),
    "experienced":  (4_000,  3),
    "fulltime":     (7_500,  3),
    "professional": (10_000, 4),
}


# Sub-segments within the Profiles bucket. Their share of the 30% Profiles
# weight is split equally across whichever sub-segments are "active" (i.e.
# the writer has populated the outline's expected_* list for them).
PROFILE_SUBSEGMENTS: tuple[tuple[str, str], ...] = (
    # (expected_field_name_in_frontmatter, filesystem_subfolder)
    ("expected_characters",    "characters"),
    ("expected_locations",     "locations"),
    ("expected_lore",          "lore"),
    ("expected_relationships", "relationships"),
)


# ── Pydantic response models ─────────────────────────────────────────────────

class ManuscriptSummary(BaseModel):
    actual_words: int
    target_words: int | None     # None if serial fiction (no fixed total)
    chapter_count: int
    weight: float                # contribution to the overall gauge (0-100)


class OutlineSummary(BaseModel):
    present: bool
    has_frontmatter: bool
    weight: float


class ProfileSubsegment(BaseModel):
    name: str                            # e.g. "characters"
    expected: int                        # count from outline expected_* list
    actual: int                          # count of profile files in the subfolder
    matched_names: list[str]             # outline names that resolved to a profile
    unmatched_names: list[str]           # outline names with no matching profile


class ProfilesSummary(BaseModel):
    weight: float
    subsegments: list[ProfileSubsegment]


class NotesSummary(BaseModel):
    present: bool
    file_count: int
    weight: float


class SummaryResponse(BaseModel):
    story_type: str
    is_serial: bool                      # True for serial_fiction; gauge renders placeholder card
    percent: float                       # overall computed gauge percentage (0-100)
    manuscript: ManuscriptSummary
    outline: OutlineSummary
    profiles: ProfilesSummary
    notes: NotesSummary


class TaskCreditEntry(BaseModel):
    file_relpath: str
    reason: str                           # "save" | "advisor_default" | "advisor_full_set"


class DailySparklineCell(BaseModel):
    local_date: str                       # YYYY-MM-DD
    words: int
    tasks: int
    hit: bool                             # both word_target AND task_target met


class DailyResponse(BaseModel):
    skill_level: str
    word_target: int
    task_target: int
    rollover_hour: int                   # 0 = midnight, 4 = night owl
    today_local_date: str                 # YYYY-MM-DD (after rollover shift)
    today_words: int
    today_tasks: list[TaskCreditEntry]
    sparkline_7day: list[DailySparklineCell]   # oldest first, ending today


# ── Helpers: project + outline reads ─────────────────────────────────────────

def _load_project_json(project_path: str) -> dict:
    """
    Read project.json. Raises HTTPException if missing or malformed --
    we want the gauge to surface a clear "this isn't a project" error
    rather than silently degrade.
    """
    project_file = os.path.join(project_path, "project.json")
    if not os.path.exists(project_file):
        raise HTTPException(status_code=404, detail=f"No project.json in: {project_path}")
    try:
        with open(project_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"project.json unreadable: {exc}") from exc


def _read_outline(project_path: str) -> tuple[str | None, dict[str, Any]]:
    """
    Return (outline_text, parsed_frontmatter). Both are None / {} if the
    outline doesn't exist. Never raises -- a missing outline is a normal
    state for old or freshly-templated projects.
    """
    outline_path = os.path.join(project_path, "notes", "outline.md")
    if not os.path.isfile(outline_path):
        return None, {}
    try:
        with open(outline_path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None, {}
    return text, parse_outline_frontmatter(text)


def _profile_name_from_file(filepath: str) -> str | None:
    """
    Read a profile file's `name:` from its YAML frontmatter.

    Profile files have a frontmatter block at the top with at least an `id`
    and `name`. We just need the name for loose matching against outline
    expectations. Returns None on any failure -- callers should fall back to
    the filename stem.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None

    # Profiles use the same `---\n...\n---` frontmatter convention as the
    # outline. Reuse the outline parser for the extraction.
    fm = parse_outline_frontmatter(text)
    name = fm.get("name")
    return str(name).strip() if isinstance(name, str) and name.strip() else None


def _list_profile_names(project_path: str, subfolder: str) -> list[str]:
    """
    Return the `name:` field for every profile in profiles/<subfolder>/.

    Falls back to the filename stem (sans .md, sans trailing ID) when a
    profile file has no name field -- still better than nothing for the
    loose-match check.
    """
    folder = os.path.join(project_path, "profiles", subfolder)
    if not os.path.isdir(folder):
        return []

    names: list[str] = []
    for fname in os.listdir(folder):
        if not fname.endswith(".md"):
            continue
        path = os.path.join(folder, fname)
        if not os.path.isfile(path):
            continue
        name = _profile_name_from_file(path)
        if name:
            names.append(name)
        else:
            # Fallback: use the filename stem. Profile filenames look like
            # "kael-01abc123.md"; we strip the .md and the trailing -shortid
            # if present so a typo'd outline name still has a chance to match.
            stem = fname[:-3]
            stem = stem.rsplit("-", 1)[0] if "-" in stem else stem
            names.append(stem.replace("-", " "))
    return names


def _loose_name_match(outline_name: str, profile_names: list[str]) -> str | None:
    """
    Case-insensitive bidirectional substring match.

    Returns the matched profile name (so the UI can show "Kael -> Kael Ashen")
    or None if no profile matches. We try both directions so the writer can
    write either "Kael" (short) or "Kael Ashen" (full) in the outline and
    still resolve to a profile named the other way.
    """
    needle = outline_name.strip().lower()
    if not needle:
        return None
    for profile in profile_names:
        hay = profile.strip().lower()
        if needle in hay or hay in needle:
            return profile
    return None


# ── Helpers: file system word counts ─────────────────────────────────────────

def _manuscript_word_count(project_path: str) -> tuple[int, int]:
    """Return (total_words, chapter_count) for the manuscript/ folder."""
    folder = os.path.join(project_path, "manuscript")
    if not os.path.isdir(folder):
        return 0, 0

    total = 0
    chapters = 0
    for fname in sorted(os.listdir(folder)):
        if not fname.endswith(".md"):
            continue
        path = os.path.join(folder, fname)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                total += count_words(f.read())
            chapters += 1
        except OSError:
            continue
    return total, chapters


def _notes_present(project_path: str) -> tuple[bool, int]:
    """
    Returns (present, file_count) for notes other than outline.md.

    The outline gets its own segment in the gauge, so we don't double-count
    it under Notes. The Notes segment captures style guides, theme docs,
    research notes, etc. -- anything else the writer has put in notes/.
    """
    folder = os.path.join(project_path, "notes")
    if not os.path.isdir(folder):
        return False, 0
    count = 0
    for fname in os.listdir(folder):
        if not fname.endswith(".md"):
            continue
        if fname == "outline.md":
            continue
        if os.path.isfile(os.path.join(folder, fname)):
            count += 1
    return count > 0, count


# ── /summary endpoint ────────────────────────────────────────────────────────

@router.get("/summary", response_model=SummaryResponse)
async def get_summary(project_path: str) -> SummaryResponse:
    """
    Compute the Project Completion gauge for a project.

    Math reminder (see docs/roadmap.md "Writing Progress Tracking -- Detailed
    Spec" for the locked design):
      With full Outline: Manuscript 50% / Outline 10% / Profiles bucket 30% /
      Notes 10%. Profile sub-segments split the 30% equally across whichever
      have an expected_* list populated.
      Without Outline frontmatter: Manuscript 100%, others informational only.
    """
    project = _load_project_json(project_path)
    story_type = project.get("story_type", "novel")
    is_serial = story_type == "serial_fiction"

    # Outline -- read frontmatter to know what the writer is planning toward.
    outline_text, frontmatter = _read_outline(project_path)
    has_frontmatter = bool(frontmatter)

    # Manuscript -- words on disk vs. target from outline (or template default).
    manuscript_actual, chapter_count = _manuscript_word_count(project_path)
    target_from_outline = frontmatter.get("target_word_count")
    if isinstance(target_from_outline, int) and target_from_outline > 0:
        manuscript_target: int | None = target_from_outline
    else:
        # Fall back to per-template default. Serial fiction has None -- the
        # gauge renders a placeholder card instead of a percentage.
        defaults = TEMPLATE_DEFAULTS.get(story_type, TEMPLATE_DEFAULTS["novel"])
        manuscript_target = defaults.get("target_word_count")

    # Notes -- binary presence check (excluding outline.md, which has its
    # own gauge segment).
    notes_present, notes_count = _notes_present(project_path)

    # Profiles bucket -- match each outline expectation against the actual
    # profile files. Even sub-segments without expectations are reported so
    # the breakdown UI can show "-no entry-" rows.
    profile_subsegments: list[ProfileSubsegment] = []
    for expected_field, subfolder in PROFILE_SUBSEGMENTS:
        expected_list = frontmatter.get(expected_field, []) or []
        if not isinstance(expected_list, list):
            expected_list = []
        # Stringify and de-dup expected names so weird YAML doesn't crash us.
        expected_names = [str(n).strip() for n in expected_list if str(n).strip()]
        profile_names = _list_profile_names(project_path, subfolder)

        matched: list[str] = []
        unmatched: list[str] = []
        for name in expected_names:
            hit = _loose_name_match(name, profile_names)
            (matched if hit else unmatched).append(name)

        profile_subsegments.append(ProfileSubsegment(
            name=subfolder,
            expected=len(expected_names),
            actual=len(profile_names),
            matched_names=matched,
            unmatched_names=unmatched,
        ))

    # ── Weights ──
    # If we have frontmatter the gauge uses the locked 50/10/30/10 split.
    # Otherwise the manuscript carries 100% and other segments are info-only.
    if has_frontmatter and not is_serial:
        manuscript_weight = 50.0
        outline_weight = 10.0
        profiles_weight = 30.0
        notes_weight = 10.0
    else:
        manuscript_weight = 100.0
        outline_weight = 0.0
        profiles_weight = 0.0
        notes_weight = 0.0

    # ── Per-segment completion percentages ──
    # Each one is "how much of THIS segment is done?" (0-100). The overall
    # gauge percent is the weighted sum divided by 100.
    if manuscript_target and manuscript_target > 0:
        manuscript_pct = min(100.0, 100.0 * manuscript_actual / manuscript_target)
    else:
        manuscript_pct = 0.0   # serial fiction or zero target -> info only

    outline_pct = 100.0 if has_frontmatter else 0.0

    # Profiles: split the 30% evenly across sub-segments that have an
    # expectation, then each contributes (matched / expected) * its slice.
    active_subs = [s for s in profile_subsegments if s.expected > 0]
    profiles_pct = 0.0
    if active_subs:
        per_sub_share = 100.0 / len(active_subs)   # share within the 30% bucket
        for sub in active_subs:
            profiles_pct += per_sub_share * len(sub.matched_names) / sub.expected
        profiles_pct = min(100.0, profiles_pct)

    notes_pct = 100.0 if notes_present else 0.0

    # Overall percent: weighted sum / 100. Serial fiction gets 0 from the
    # gauge; the frontend recognizes is_serial=True and renders the
    # placeholder card instead of a number.
    if is_serial:
        overall_pct = 0.0
    else:
        overall_pct = (
            manuscript_weight * manuscript_pct
            + outline_weight * outline_pct
            + profiles_weight * profiles_pct
            + notes_weight * notes_pct
        ) / 100.0

    return SummaryResponse(
        story_type=story_type,
        is_serial=is_serial,
        percent=round(overall_pct, 1),
        manuscript=ManuscriptSummary(
            actual_words=manuscript_actual,
            target_words=manuscript_target,
            chapter_count=chapter_count,
            weight=manuscript_weight,
        ),
        outline=OutlineSummary(
            present=outline_text is not None,
            has_frontmatter=has_frontmatter,
            weight=outline_weight,
        ),
        profiles=ProfilesSummary(
            weight=profiles_weight,
            subsegments=profile_subsegments,
        ),
        notes=NotesSummary(
            present=notes_present,
            file_count=notes_count,
            weight=notes_weight,
        ),
    )


# ── /daily endpoint ──────────────────────────────────────────────────────────

# Distinct advisor categories that together count as a full sweep equivalent
# to a "default" run. Order doesn't matter -- presence is what we check.
_FULL_SWEEP_CATEGORIES: frozenset[str] = frozenset({"readability", "structure", "context"})


async def _credited_chapters_from_advisor(
    project_path: str, local_date: str
) -> dict[str, str]:
    """
    Return a {file_relpath: reason} dict for chapters that earn an advisor
    task credit today.

    Rules (locked in docs/roadmap.md):
      - A 'default' advisor_run row for the chapter today -> credit
        (reason = "advisor_default")
      - Otherwise all three of {readability, structure, context} present today
        -> credit (reason = "advisor_full_set")
    """
    credited: dict[str, str] = {}

    async with open_db(project_path) as db:
        cursor = await db.execute(
            "SELECT file_relpath, advisor_category FROM progress_event "
            "WHERE project_path = ? AND local_date = ? "
            "AND event_type = 'advisor_run' AND file_relpath IS NOT NULL",
            (project_path, local_date),
        )
        rows = await cursor.fetchall()
        await cursor.close()

    # Group categories by file
    per_file: dict[str, set[str]] = {}
    for relpath, category in rows:
        if not relpath or not category:
            continue
        per_file.setdefault(relpath, set()).add(category)

    for relpath, cats in per_file.items():
        if "default" in cats:
            credited[relpath] = "advisor_default"
        elif _FULL_SWEEP_CATEGORIES.issubset(cats):
            credited[relpath] = "advisor_full_set"
    return credited


async def _daily_totals(
    project_path: str, local_date: str
) -> tuple[int, list[TaskCreditEntry]]:
    """
    Return (today_words, today_tasks). Combines save-driven task_credit rows
    with the advisor-rule-derived credits, with save credits winning when a
    file has both (more specific reason).
    """
    async with open_db(project_path) as db:
        # Today's word total
        cursor = await db.execute(
            "SELECT COALESCE(SUM(word_delta), 0) FROM progress_event "
            "WHERE project_path = ? AND local_date = ? AND event_type = 'word_delta'",
            (project_path, local_date),
        )
        row = await cursor.fetchone()
        today_words = max(0, int(row[0] or 0))   # clamp negatives (deletions)
        await cursor.close()

        # Files credited via direct task_credit rows (saves)
        cursor = await db.execute(
            "SELECT DISTINCT file_relpath FROM progress_event "
            "WHERE project_path = ? AND local_date = ? AND event_type = 'task_credit' "
            "AND file_relpath IS NOT NULL",
            (project_path, local_date),
        )
        save_credited = {row[0] for row in await cursor.fetchall() if row[0]}
        await cursor.close()

    advisor_credited = await _credited_chapters_from_advisor(project_path, local_date)

    # Build the unified list: save credits first, then advisor-only credits.
    today_tasks: list[TaskCreditEntry] = [
        TaskCreditEntry(file_relpath=rp, reason="save")
        for rp in sorted(save_credited)
    ]
    for rp, reason in sorted(advisor_credited.items()):
        if rp in save_credited:
            continue   # already credited via save, don't double-count
        today_tasks.append(TaskCreditEntry(file_relpath=rp, reason=reason))

    return today_words, today_tasks


@router.get("/daily", response_model=DailyResponse)
async def get_daily(project_path: str) -> DailyResponse:
    """
    Today's progress + a 7-day hit/miss sparkline.

    "Today" is the local_date after applying the configured day_rollover_hour
    shift (Night Owl mode pushes the boundary from midnight to 4am).
    """
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"No such project: {project_path}")

    settings = load_settings()
    skill = str(settings.get("writing_skill_level", "novice"))
    if skill not in SKILL_TARGETS:
        skill = "novice"
    word_target, task_target = SKILL_TARGETS[skill]
    rollover = get_rollover_hour()

    # Determine "today" as the local_date the gauge uses for grouping.
    now_iso = datetime.now().isoformat(timespec="seconds")
    today_str = local_date_for(now_iso, rollover)

    today_words, today_tasks = await _daily_totals(project_path, today_str)

    # Sparkline: today and the six preceding local dates. Oldest first so
    # the frontend can render left-to-right without reversing.
    today_date = date.fromisoformat(today_str)
    sparkline_dates = [today_date - timedelta(days=offset) for offset in range(6, -1, -1)]

    sparkline: list[DailySparklineCell] = []
    for d in sparkline_dates:
        d_str = d.isoformat()
        words, tasks = await _daily_totals(project_path, d_str)
        sparkline.append(DailySparklineCell(
            local_date=d_str,
            words=words,
            tasks=len(tasks),
            hit=words >= word_target and len(tasks) >= task_target,
        ))

    return DailyResponse(
        skill_level=skill,
        word_target=word_target,
        task_target=task_target,
        rollover_hour=rollover,
        today_local_date=today_str,
        today_words=today_words,
        today_tasks=today_tasks,
        sparkline_7day=sparkline,
    )
