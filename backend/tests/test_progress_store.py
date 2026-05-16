# tests/test_progress_store.py
# =============================
# Unit and integration tests for progress_store.py -- the SQLite layer that
# records Writing Progress events (word deltas, task credits, advisor runs).
#
# Async tests run under asyncio via `asyncio_mode = "auto"` in pyproject.toml.
# Each async test that touches the database uses pytest's `tmp_path` fixture,
# which provides a fresh temporary directory per test -- so there is no
# cross-test DB pollution.

from app.progress_store import (
    count_words,
    local_date_for,
    open_db,
    record_advisor_run,
    record_save_event,
)


# ── count_words ──────────────────────────────────────────────────────────────
# These are pure-function tests: no I/O, no async.

def test_count_words_basic_sentence():
    assert count_words("Hello world, how are you?") == 5


def test_count_words_strips_yaml_frontmatter():
    # Frontmatter at the top of a Markdown file should not count as prose.
    # "target_word_count: 90000" is metadata, not story text.
    text = "---\ntarget_word_count: 90000\nauthor: Dean\n---\n\nhello world"
    assert count_words(text) == 2


def test_count_words_strips_fenced_code_blocks():
    # Writers rarely paste code into a story, but if they do the code lines
    # shouldn't inflate the word count.
    text = "Before the code.\n```\ncode line one\ncode line two\n```\nAfter the code."
    result = count_words(text)
    # Only "Before the code." (3) + "After the code." (3) = 6
    assert result == 6


def test_count_words_empty_string_returns_zero():
    assert count_words("") == 0


def test_count_words_none_returns_zero():
    assert count_words(None) == 0


def test_count_words_whitespace_only_returns_zero():
    assert count_words("   \n\n   ") == 0


# ── local_date_for ───────────────────────────────────────────────────────────
# The night-owl rollover shifts the "day boundary" so 2am still counts
# toward yesterday's progress for writers who work past midnight.

def test_local_date_midnight_rollover_treats_2am_as_today():
    result = local_date_for("2026-05-15T02:00:00", rollover_hour=0)
    assert result == "2026-05-15"


def test_local_date_night_owl_treats_2am_as_yesterday():
    # rollover_hour=4: anything before 4am belongs to the previous day.
    result = local_date_for("2026-05-15T02:00:00", rollover_hour=4)
    assert result == "2026-05-14"


def test_local_date_night_owl_treats_5am_as_today():
    # 5am is past the 4am rollover, so it's the new day.
    result = local_date_for("2026-05-15T05:00:00", rollover_hour=4)
    assert result == "2026-05-15"


def test_local_date_exactly_at_rollover_hour_is_new_day():
    # 04:00:00 is NOT before the rollover (dt.hour < 4 is False), so it's today.
    result = local_date_for("2026-05-15T04:00:00", rollover_hour=4)
    assert result == "2026-05-15"


# ── record_save_event ────────────────────────────────────────────────────────
# These are async integration tests that actually write to a temp SQLite DB.

async def test_record_save_creates_word_delta_row(tmp_path):
    # Saving a file with 2 words when no previous content -> delta = +2
    await record_save_event(str(tmp_path), "manuscript/ch01.md", "hello world", None)

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT event_type, word_delta FROM progress_event WHERE event_type = 'word_delta'"
        )
        rows = await cursor.fetchall()
        await cursor.close()

    assert len(rows) == 1
    assert rows[0][1] == 2  # delta from 0 to 2 words


async def test_record_save_creates_task_credit_row(tmp_path):
    await record_save_event(
        str(tmp_path), "manuscript/ch01.md", "hello world", None,
        count_for_task_credit=True,
    )

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM progress_event WHERE event_type = 'task_credit'"
        )
        row = await cursor.fetchone()
        await cursor.close()

    assert row[0] == 1


async def test_task_credit_is_idempotent_per_file_per_day(tmp_path):
    # Saving the same file twice in the same day earns only ONE task credit,
    # because the credit is "you worked on this file today", not "each save".
    await record_save_event(str(tmp_path), "manuscript/ch01.md", "hello world", None)
    await record_save_event(
        str(tmp_path), "manuscript/ch01.md", "hello world plus more", "hello world"
    )

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM progress_event WHERE event_type = 'task_credit'"
        )
        row = await cursor.fetchone()
        await cursor.close()

    assert row[0] == 1  # still just one credit


async def test_task_credit_is_separate_per_file(tmp_path):
    # Saving two different files on the same day earns a credit for each.
    await record_save_event(str(tmp_path), "manuscript/ch01.md", "chapter one text", None)
    await record_save_event(str(tmp_path), "manuscript/ch02.md", "chapter two text", None)

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM progress_event WHERE event_type = 'task_credit'"
        )
        row = await cursor.fetchone()
        await cursor.close()

    assert row[0] == 2


async def test_no_delta_row_when_word_count_unchanged(tmp_path):
    # Saving without changing the word count (e.g. only punctuation changed)
    # does not insert a word_delta row.
    await record_save_event(
        str(tmp_path), "manuscript/ch01.md",
        "hello world",   # new content
        "hello world",   # same as previous -- delta = 0
    )

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM progress_event WHERE event_type = 'word_delta'"
        )
        row = await cursor.fetchone()
        await cursor.close()

    assert row[0] == 0  # no delta row


async def test_no_task_credit_when_count_for_task_credit_false(tmp_path):
    # AI-generated content (summaries) logs word deltas but does NOT earn a
    # task credit -- the writer didn't actively work on the file.
    await record_save_event(
        str(tmp_path), "profiles/summaries/ch01.md", "AI summary text here", None,
        count_for_task_credit=False,
    )

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM progress_event WHERE event_type = 'task_credit'"
        )
        row = await cursor.fetchone()
        await cursor.close()

    assert row[0] == 0


# ── record_advisor_run ───────────────────────────────────────────────────────

async def test_record_advisor_run_inserts_row(tmp_path):
    await record_advisor_run(str(tmp_path), "manuscript/ch01.md", "readability")

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT event_type, advisor_category FROM progress_event"
        )
        rows = await cursor.fetchall()
        await cursor.close()

    assert len(rows) == 1
    assert rows[0][0] == "advisor_run"
    assert rows[0][1] == "readability"


async def test_record_multiple_advisor_runs_same_chapter(tmp_path):
    # All three category runs recorded separately -- the aggregation layer
    # (progress router) later decides if they add up to a full-sweep credit.
    await record_advisor_run(str(tmp_path), "manuscript/ch01.md", "readability")
    await record_advisor_run(str(tmp_path), "manuscript/ch01.md", "structure")
    await record_advisor_run(str(tmp_path), "manuscript/ch01.md", "context")

    async with open_db(tmp_path) as db:
        cursor = await db.execute(
            "SELECT advisor_category FROM progress_event WHERE event_type = 'advisor_run'"
        )
        rows = await cursor.fetchall()
        await cursor.close()

    categories = {row[0] for row in rows}
    assert categories == {"readability", "structure", "context"}
