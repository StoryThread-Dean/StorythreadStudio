# tests/test_quick_overview.py -- Side-character Generate Overview
# ==================================================================
# /api/ai/generate-quick-overview spins a side character's filled-in fields
# into a compact Overview. It is a deliberate, writer-clicked exception to
# the no-ghostwriting stance -- so the prompt's guardrails (ground in the
# provided details, no new named facts, hidden details stay subtext, vary
# the angle per click) are the contract these tests pin down.

from app.ai.prompts import TEMPERATURE_DEFAULTS, generate_quick_overview_prompt
from app.routers import ai


# ── The prompt ───────────────────────────────────────────────────────────────

def test_prompt_grounds_and_limits_embellishment():
    text = generate_quick_overview_prompt()
    assert "Ground every claim in the provided details" in text
    assert "do not invent new named people, places, events, or relationships" in text


def test_prompt_keeps_hidden_details_as_subtext():
    text = generate_quick_overview_prompt()
    assert "subtext only" in text
    assert "NEVER state the secret itself" in text


def test_prompt_varies_angle_and_stays_compact():
    text = generate_quick_overview_prompt()
    assert "VARY YOUR ANGLE" in text
    assert "80-150 words" in text
    # Output must be bare prose the frontend can drop into the field.
    assert "No preamble" in text


def test_prompt_demands_retelling_around_a_through_line():
    # The v1 prompt produced jumbled trait-stitching. The fix: inputs are
    # declared shorthand to be RETOLD, the want is the through-line, and the
    # hook / body / undercurrent shape is spelled out.
    text = generate_quick_overview_prompt()
    assert "RETELL" in text
    assert "through-line is the character's WANT" in text
    assert "HOOK" in text and "UNDERCURRENT" in text
    assert "Jumbled trait-listing is failure" in text


def test_prompt_includes_a_worked_example():
    # Few-shot: one full example in the target register anchors the flow
    # far better than rules alone.
    text = generate_quick_overview_prompt()
    assert "Maren Voss" in text
    assert "match the flow" in text


def test_prompt_hierarchy_role_is_lens_traits_are_evidence():
    # Second polish pass: Role + Tags frame the story, the want drives it,
    # and traits are a pool to SELECT from -- the coverage compulsion of
    # weaving in every fragment is what fragmented the early outputs.
    text = generate_quick_overview_prompt()
    assert "STORY FUNCTION (Role + Tags) is the LENS" in text
    assert "The WANT is the ENGINE" in text
    assert "EVIDENCE, not a checklist" in text
    assert "4-6" in text
    assert "LEAVE THE REST OUT" in text


# ── The endpoint (hermetic: no network, no real settings) ────────────────────

def _patch(monkeypatch, captured):
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda mid: (ai.OPENROUTER, "fake-key", mid or "test/model"))
    monkeypatch.setattr(ai, "_build_story_context", lambda *a, **k: "")

    async def fake_run_chat(**kwargs):
        captured.update(kwargs)
        return "  The barkeep everyone underestimates.  "

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)


def test_endpoint_builds_prompt_from_filled_fields_only(client, monkeypatch):
    captured = {}
    _patch(monkeypatch, captured)

    resp = client.post("/api/ai/generate-quick-overview", json={
        "name": "Barkeep Tam",
        "role": "Comic Relief",
        "tags": ["humor", "timing"],
        "sections": {
            "Voice Notes": "dry one-liners delivered completely deadpan",
            "Motivations": "",  # empty -> must be omitted from the prompt
        },
    })
    assert resp.status_code == 200, resp.text
    # Reply is trimmed before landing in the Overview field.
    assert resp.json()["overview"] == "The barkeep everyone underestimates."

    user_msg = captured["messages"][0]["content"]
    assert "Barkeep Tam" in user_msg
    assert "Comic Relief" in user_msg
    assert "humor, timing" in user_msg
    assert "dry one-liners" in user_msg
    assert "Motivations" not in user_msg  # empty section dropped


def test_endpoint_structures_message_as_lens_engine_material(client, monkeypatch):
    # The user message mirrors the hierarchy in the data itself: story
    # function first, the Motivations text promoted to the WANT slot, and
    # everything else demoted to selectable raw material.
    captured = {}
    _patch(monkeypatch, captured)

    resp = client.post("/api/ai/generate-quick-overview", json={
        "name": "Elenore",
        "role": "Rival",
        "tags": ["competitor", "foil"],
        "sections": {
            "Motivations": "wants to finally beat their rival at something that counts",
            "Voice Notes": "quotes books that do not exist with page numbers",
        },
    })
    assert resp.status_code == 200, resp.text
    msg = captured["messages"][0]["content"]

    lens_at = msg.index("STORY FUNCTION")
    want_at = msg.index("WANT (the engine")
    raw_at = msg.index("RAW MATERIAL")
    assert lens_at < want_at < raw_at

    # The want text lives in the engine slot, not among the fragments.
    assert "beat their rival" in msg[want_at:raw_at]
    assert "quotes books" in msg[raw_at:]


def test_endpoint_uses_generation_temperature_and_prose_sanitizer(client, monkeypatch):
    # Variety-per-click comes from generation temperature + the prompt's
    # vary-your-angle rule; prose mode keeps the approved ' -- ' since the
    # text lands in the profile, not a chat bubble.
    captured = {}
    _patch(monkeypatch, captured)

    resp = client.post("/api/ai/generate-quick-overview", json={"name": "Tam"})
    assert resp.status_code == 200, resp.text
    assert captured["temperature"] == TEMPERATURE_DEFAULTS["generation"]
    assert captured["sanitize_mode"] == "prose"
    assert "VARY YOUR ANGLE" in captured["system_prompt"]


def test_endpoint_carries_content_mode(client, monkeypatch):
    captured = {}
    _patch(monkeypatch, captured)

    resp = client.post("/api/ai/generate-quick-overview", json={
        "name": "Tam", "content_mode": "mature",
    })
    assert resp.status_code == 200, resp.text
    assert "CONTENT MODE: MATURE" in captured["system_prompt"]
