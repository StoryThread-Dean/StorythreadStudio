# tests/test_ai_notes.py -- the writer's standing notes for the book
# ===================================================================
# notes/ai-notes.md is the writer's running guidance on how the story is being
# built: decisions taken, things that changed, how they want to be helped. It
# is sent with EVERY AI request from a surface that can show it.
#
# Its sibling, notes/author-notes.md, is the exact opposite and always has
# been: the writer's own room, excluded from AI by name. The two files sit
# next to each other in the sidebar, so the promises had better not blur.
# That is what most of this file is protecting.
#
# WHY IT IS A REQUEST FIELD AND NOT A FILE READ. If a route opened
# notes/ai-notes.md itself, every endpoint would send it whether or not it had
# any way of telling the writer so -- and the locked context rule
# (docs/product-scope.md) says they must be able to inspect it, drop it and
# switch it off. A field can only be filled by a surface that has a control.
# `test_no_route_reads_the_notes_file_itself` is that rule as a source read.

import inspect

from app.routers import ai


def _patch_auth(monkeypatch):
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda role, mid=None: (ai.OPENROUTER, "fake-key", mid or "test/model"))
    monkeypatch.setattr(ai, "_validate_model_content_mode", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_validate_model_allowed", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_build_story_context", lambda *a, **k: "")


def _capture_run_chat(monkeypatch):
    captured = {}

    async def fake_run_chat(**kwargs):
        captured.update(kwargs)
        return "ok reply"

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)
    return captured


NOTES = "- Vance is the traitor now, changed in ch 12.\n- Do not soften Milton."


def _sent(captured) -> str:
    """Everything the model was handed, system prompt and messages together."""
    parts = [captured.get("system_prompt", "")]
    parts += [m.get("content", "") for m in captured.get("messages", [])]
    return "\n".join(parts)


# ── It arrives ───────────────────────────────────────────────────────────────

def test_the_notes_reach_the_model(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "how is this going?"}],
        "ai_notes": NOTES,
    })
    assert resp.status_code == 200, resp.text
    assert "Vance is the traitor now" in _sent(captured)


def test_nothing_is_sent_when_the_writer_has_none(client, monkeypatch):
    # The ordinary state of a project. A heading with nothing under it would
    # spend tokens saying the writer has said nothing.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "ai_notes": "",
    })
    assert resp.status_code == 200, resp.text
    assert "AI NOTES" not in _sent(captured)


def test_whitespace_only_notes_count_as_none(client, monkeypatch):
    # An empty file that has been opened and saved once is "   \n\n".
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "chat", "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "ai_notes": "   \n\n  ",
    })
    assert "AI NOTES" not in _sent(captured)


def test_the_notes_alone_are_enough_to_build_materials(client, monkeypatch):
    """
    THE ONE THIS REPO KEEPS GETTING WRONG, three materials running.

    `has_new_materials` decides whether a materials block is built at all. A
    material left out of that check is silently dropped on any turn where
    nothing else happens to be new -- no error, no failing test, and a reply
    that is subtly worse for a reason nobody can see. It happened to the Weave
    brief and again to the chapter outline. Here it is asserted directly: no
    chapter, no chips, no selection, nothing but the notes.
    """
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "chat", "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "context_chips": [], "weave_brief": "", "chapter_outline": "",
        "ai_notes": NOTES,
    })
    assert "Do not soften Milton" in _sent(captured)


# ── It is guidance, so it goes first ─────────────────────────────────────────

def test_the_notes_come_before_the_material_they_govern(client, monkeypatch):
    """
    Everything else in the materials block is ordered narrowest-first, because
    it is all MATERIAL. This is not material -- it is how to read the material.
    Guidance that arrives after the thing it governs has already been read.
    """
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "draft",
        "text_content": "The column crested the ridge.",
        "is_full_chapter": False,
        "messages": [{"role": "user", "content": "continue"}],
        "context_chips": [{"type": "character", "name": "Kipling",
                           "content": "Counts things when frightened."}],
        "chapter_outline": "1. They are spotted.",
        "weave_brief": "Kipling (Character)",
        "ai_notes": NOTES,
    })
    body = _sent(captured)
    assert body.index("BEGIN AI NOTES") < body.index("BEGIN CHAPTER OUTLINE")
    assert body.index("BEGIN AI NOTES") < body.index("Counts things when frightened")


def test_it_is_not_gated_to_draft_and_enhance(client, monkeypatch):
    """
    The chapter outline IS gated, and correctly: it describes one chapter, so
    it is meaningless to a readability pass. Standing guidance is standing --
    a general question deserves it as much as a draft does, and gating it
    would mean the writer's "the narrator is unreliable on purpose" note only
    applied while drafting.
    """
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "readability", "text_content": "Some prose.",
        "messages": [{"role": "user", "content": "what do you think?"}],
        "chapter_outline": "1. They are spotted.",
        "ai_notes": NOTES,
    })
    body = _sent(captured)
    assert "BEGIN AI NOTES" in body
    # The outline is still gated -- to the passes that read it. Open chat
    # gained it in v2.0.6 when the outline screen got a chat panel, so a
    # REVIEW pass is what shows the difference now.
    assert "BEGIN CHAPTER OUTLINE" not in body


# ── The Smart Advisor gets them, which is the point ──────────────────────────

def test_the_advisor_is_told_what_is_deliberate(client, monkeypatch):
    """
    The Advisor reports what it believes is wrong. The single most useful
    thing a writer can tell it is which of those things they meant. Sending
    the notes everywhere EXCEPT the check that raises the finding would
    withhold them from the one place they prevent a wrong answer.
    """
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-pass", json={
        "category": "readability",
        "chapter_text": "Fragments. Everywhere. On purpose.",
        "is_selection": False,
        "ai_notes": "- The fragments are deliberate. Do not flag them.",
    })
    assert resp.status_code == 200, resp.text
    assert "The fragments are deliberate" in _sent(captured)


def test_a_revision_is_given_the_voice_rules(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/revise-suggestion", json={
        "quote": "She was very angry.",
        "current_suggestion": "She was furious.",
        "modifier": "default",
        "ai_notes": "- She never swears.",
    })
    assert resp.status_code == 200, resp.text
    assert "She never swears" in _sent(captured)


def test_the_profile_builder_gets_them_too(client, monkeypatch):
    """
    Building a character is where standing decisions bite hardest -- "her
    mother is alive again as of chapter nine" is exactly the sort of thing a
    writer should not have to retype into every profile conversation.

    And it leads, ahead of the profile itself, for the same reason it leads in
    the editor: guidance that arrives after the material has already been read
    arrived too late to change how it was read.
    """
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/profile-chat", json={
        "profile_name": "Raul Ortiz-Reyes",
        "profile_type": "character",
        "profile_content": "Overview: a quiet man.",
        "messages": [{"role": "user", "content": "what is he hiding?"}],
        "ai_notes": "- His sister is alive again as of ch 9.",
    })
    assert resp.status_code == 200, resp.text
    body = _sent(captured)
    assert "His sister is alive again" in body
    assert body.index("BEGIN AI NOTES") < body.index("Overview: a quiet man")


def test_the_profile_builder_sends_nothing_when_there_are_none(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/profile-chat", json={
        "profile_name": "Raul", "profile_type": "character",
        "profile_content": "Overview: a quiet man.",
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert "AI NOTES" not in _sent(captured)


# ── The cap, and why it is a refusal ─────────────────────────────────────────

def test_oversize_notes_are_refused_rather_than_trimmed(client, monkeypatch):
    """
    Every other material is sent once, for one request. These are sent on
    EVERY request, so an oversize file is not one expensive call -- it is
    every call from now on, permanently, until the writer notices a bill.

    Refused rather than silently trimmed, because a trim would leave them
    believing guidance is in force that was cut off mid-sentence.
    """
    _patch_auth(monkeypatch)
    _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat", "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "ai_notes": "x" * 20_001,
    })
    assert resp.status_code == 400
    assert "20,000" in resp.json()["detail"]


def test_the_refusal_says_what_to_do_about_it(client, monkeypatch):
    # A limit with no way out is a dead end, which this app treats as a bug.
    _patch_auth(monkeypatch)
    _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat", "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "ai_notes": "x" * 20_001,
    })
    detail = resp.json()["detail"]
    assert "attach" in detail or "switch AI Notes off" in detail


def test_a_long_but_legal_file_still_goes(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat", "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "ai_notes": "y" * 19_999,
    })
    assert resp.status_code == 200
    assert "yyyy" in _sent(captured)


# ── The two files must not blur ──────────────────────────────────────────────

def test_author_notes_is_still_the_private_one():
    """
    Adding a notes file that IS sent to AI, right beside the one that is
    never sent, is exactly the circumstance under which the old promise gets
    broken by accident. Asserted here as well as in test_planning_sources.py
    so the guard sits next to the thing that endangers it.
    """
    from app.codex.scan import PRIVATE_NOTES

    assert "author-notes.md" in PRIVATE_NOTES
    assert "ai-notes.md" not in PRIVATE_NOTES


def test_the_two_files_are_offered_as_a_pair():
    # If a writer sees only one of them they will use the wrong one. Both are
    # note sections, and the AI one is not hidden behind anything.
    from app.codex.sections import NOTE_SECTIONS

    by_file = {n["filename"]: n for n in NOTE_SECTIONS}
    assert by_file["author-notes.md"]["label"] == "Author Notes"
    assert by_file["ai-notes.md"]["label"] == "AI Notes"


def test_no_route_reads_the_notes_file_itself():
    """
    THE RULE THAT KEEPS THE OFF SWITCH HONEST, as a source read.

    The writer's control over automatic context is a promise the app cannot
    keep if a backend route opens notes/ai-notes.md on its own initiative --
    the switch lives on a screen, and a route that reads the file has no idea
    the switch exists. So the notes may only ever ARRIVE, as a field.

    A source read rather than a behaviour test, because the risk is a future
    route added by someone who reasonably thinks reading the file is simpler.

    Comments are stripped first. The rule is about what the code DOES, and the
    field's own docstring has to be free to name the file it corresponds to --
    which is exactly what tripped this test the first time it ran.
    """
    code = "\n".join(
        line for line in inspect.getsource(ai).splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "ai-notes.md" not in code
