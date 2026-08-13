# tests/test_model_roles.py -- Model Roles: one model per KIND of job
# ====================================================================
# app/ai/roles.py decides which provider and model handle each kind of AI
# work, and -- just as importantly -- when a job must NOT run at all.
#
# Two contracts here are load-bearing and everything else is detail:
#
#   1. An install that has never configured a role behaves EXACTLY as it
#      did before roles existed. This is the no-behaviour-change guarantee
#      that lets v1.1.1 ship to people mid-manuscript.
#
#   2. A role the writer explicitly configured never silently substitutes a
#      different model. If it cannot run, it says so. Without this, someone
#      assigns Claude to prose, the key is missing, and their book quietly
#      gets written by gpt-4o-mini instead.

import pytest

from app.ai.providers import LOCAL, NANOGPT, OPENROUTER
from app.ai.roles import ROLE_INFO, ROLES, resolve_role_model


def _settings(**overrides) -> dict:
    """A believable settings dict -- OpenRouter with a key, as shipped."""
    base = {
        "ai_provider": "openrouter",
        "openrouter_api_key": "sk-or-test",
        "nanogpt_api_key": "",
        "default_model": "openai/gpt-4o-mini",
        "prompt_caching": True,
        "model_roles": {},
        "local_base_url": "",
        "local_api_style": "openai",
    }
    base.update(overrides)
    return base


# ── The role list itself ─────────────────────────────────────────────────────

def test_there_are_eight_roles_and_fallback_is_not_one():
    # "fallback" is the writer's Default Model, not a kind of work. Keeping
    # it out of ROLES is what stops Settings from showing nine pickers and
    # implying the app does nine kinds of job.
    assert len(ROLES) == 8
    assert "fallback" not in ROLES
    assert "default" not in ROLES


def test_every_role_can_explain_itself():
    # The Settings screen renders from ROLE_INFO. A role with no label or
    # blurb would appear on screen as an unexplained dropdown. A role with
    # no features must say so via `reserved` rather than just look empty --
    # see test_role_call_sites.py, which checks that flag against the real
    # call sites so it cannot quietly become untrue.
    for role in ROLES:
        info = ROLE_INFO[role]
        assert info["label"].strip()
        assert info["blurb"].strip()
        assert info["features"] or info["reserved"], \
            f"{role} lists no features and is not marked reserved"
        # The collapsed row shows `blurb`; expanding shows `detail`. A role
        # whose detail is as short as its blurb is not explaining anything
        # the writer could not already see.
        assert len(info["detail"]) > len(info["blurb"]) * 2, \
            f"{role}'s 'What's this?' says no more than its one-line blurb"


def test_an_unknown_role_raises_rather_than_guessing():
    # Roles come from call sites, never from user input, so an unknown one
    # is a programming mistake. Failing loudly here means it surfaces in
    # tests instead of silently picking whatever the default model is.
    with pytest.raises(ValueError, match="Unknown AI role"):
        resolve_role_model(_settings(), None, "vibes")


# ── Contract 1: an unconfigured install is unchanged ─────────────────────────

def test_unconfigured_roles_resolve_exactly_as_before():
    settings = _settings()
    for role in ROLES:
        r = resolve_role_model(settings, None, role)
        assert r["source"] == "default"
        assert r["provider_key"] == "openrouter"
        assert r["model_id"] == "openai/gpt-4o-mini"
        assert r["usable"] is True
        assert r["configured"] is False


def test_an_unassigned_role_says_where_its_model_came_from():
    # Not a warning -- just honesty, so a writer who assigned six roles and
    # forgot the seventh can see which one they missed.
    r = resolve_role_model(_settings(), None, "prose")
    assert "Default Model" in r["fallback_note"]
    assert "openai/gpt-4o-mini" in r["fallback_note"]


def test_project_default_model_still_outranks_the_global_one():
    r = resolve_role_model(
        _settings(), {"default_model": "anthropic/claude-opus-4"}, "critique"
    )
    assert r["model_id"] == "anthropic/claude-opus-4"
    assert r["source"] == "default"


def test_no_model_anywhere_is_unusable_not_a_guess():
    settings = _settings(ai_provider="nanogpt", nanogpt_api_key="k", default_model="")
    r = resolve_role_model(settings, None, "critique")
    # NanoGPT deliberately has no fallback_model, so there is nothing to
    # fall back to and the honest answer is "pick one".
    assert r["usable"] is False
    assert r["source"] == "none"
    assert "Settings" in r["unusable_reason"]


# ── Precedence ───────────────────────────────────────────────────────────────

def test_settings_role_beats_the_default_chain():
    settings = _settings(model_roles={
        "critique": {"provider": "openrouter", "model": "anthropic/claude-opus-4"}
    })
    r = resolve_role_model(settings, None, "critique")
    assert r["source"] == "role"
    assert r["model_id"] == "anthropic/claude-opus-4"
    assert r["configured"] is True
    # Roles are independent: assigning critique must not move prose.
    assert resolve_role_model(settings, None, "prose")["source"] == "default"


def test_roles_are_app_wide_and_a_book_cannot_override_one():
    """
    R8.6. This test used to assert the OPPOSITE, and it passed by faking.

    A per-book `model_roles` was documented as the top of the precedence chain
    and was dead code: `_resolve_model_and_key` never reads project.json at all,
    it synthesises `{"default_model": override}` from one field the frontend
    sends. So no per-book assignment could ever have arrived here however
    faithfully it had been stored -- and this test proved otherwise by handing
    `resolve_role_model` a project dict no caller in the app can produce.

    That is the exact shape the recovery's own note warns about: a test that
    builds the world instead of observing it. The level is deleted on the
    writer's ruling; this pins that a stray `model_roles` in a project dict is
    IGNORED rather than half-honoured, so nobody reinstates it by accident.
    """
    settings = _settings(model_roles={
        "prose": {"provider": "openrouter", "model": "app/wide-model"}
    })
    project = {"model_roles": {"prose": {"provider": "openrouter",
                                        "model": "this/book-only"}}}
    r = resolve_role_model(settings, project, "prose")
    assert r["source"] == "role"
    assert r["model_id"] == "app/wide-model"


def test_a_books_default_model_still_outranks_the_app_wide_default():
    # The level that DOES work, and the one that was there before roles
    # existed. Deleting the per-book ROLE tier must not touch it.
    settings = _settings(default_model="app/wide-default")
    r = resolve_role_model(settings, {"default_model": "this/book-default"},
                           "prose")
    assert r["source"] == "default"
    assert r["model_id"] == "this/book-default"


def test_a_half_filled_assignment_counts_as_unset():
    # This is what a half-finished Settings screen leaves behind. Treating
    # it as broken would block the writer from the screen that fixes it.
    settings = _settings(model_roles={"prose": {"provider": "openrouter", "model": ""}})
    r = resolve_role_model(settings, None, "prose")
    assert r["source"] == "default"
    assert r["configured"] is False


def test_a_role_reads_the_key_of_its_own_provider():
    # The whole point of per-role providers: critique on OpenRouter and
    # prose on NanoGPT at the same time, each authenticated separately.
    settings = _settings(
        nanogpt_api_key="nano-key",
        model_roles={"prose": {"provider": "nanogpt", "model": "some/model"}},
    )
    prose = resolve_role_model(settings, None, "prose")
    critique = resolve_role_model(settings, None, "critique")
    assert prose["provider_key"] == NANOGPT.key and prose["usable"] is True
    assert critique["provider_key"] == OPENROUTER.key and critique["usable"] is True


# ── Contract 2: configured but unusable NEVER substitutes ────────────────────

def test_a_configured_role_without_a_key_refuses_instead_of_substituting():
    settings = _settings(
        nanogpt_api_key="",
        model_roles={"prose": {"provider": "nanogpt", "model": "some/model"}},
    )
    r = resolve_role_model(settings, None, "prose")
    assert r["usable"] is False
    assert r["configured"] is True
    # The critical assertion: it reports what the writer ASKED for, not
    # some working alternative. A substitution here is the silent-swap bug.
    assert r["provider_key"] == "nanogpt"
    assert r["model_id"] == "some/model"
    assert "NanoGPT" in r["unusable_reason"]
    assert "gpt-4o-mini" not in str(r["unusable_reason"])


def test_an_unknown_provider_is_named_rather_than_replaced():
    settings = _settings(model_roles={
        "critique": {"provider": "some-dead-service", "model": "x/y"}
    })
    r = resolve_role_model(settings, None, "critique")
    assert r["usable"] is False
    assert r["provider_key"] == "some-dead-service"
    assert "some-dead-service" in r["unusable_reason"]


def test_an_unusable_role_does_not_borrow_a_working_siblings_model():
    # Two roles, one healthy and one broken. The broken one must not
    # quietly inherit the healthy one's model.
    settings = _settings(
        nanogpt_api_key="",
        model_roles={
            "critique": {"provider": "openrouter", "model": "good/model"},
            "prose":    {"provider": "nanogpt",    "model": "broken/model"},
        },
    )
    assert resolve_role_model(settings, None, "critique")["usable"] is True
    prose = resolve_role_model(settings, None, "prose")
    assert prose["usable"] is False
    assert prose["model_id"] == "broken/model"


# ── The local provider ───────────────────────────────────────────────────────

def test_a_local_role_needs_no_api_key():
    settings = _settings(
        local_base_url="http://localhost:11434",
        model_roles={"prose": {"provider": "local", "model": "mythomax"}},
    )
    r = resolve_role_model(settings, None, "prose")
    assert r["usable"] is True
    assert r["requires_api_key"] is False
    assert r["provider_key"] == LOCAL.key


def test_a_local_role_with_no_address_is_unusable():
    settings = _settings(
        local_base_url="",
        model_roles={"prose": {"provider": "local", "model": "mythomax"}},
    )
    r = resolve_role_model(settings, None, "prose")
    assert r["usable"] is False
    assert "address" in r["unusable_reason"].lower()


def test_a_local_role_pointed_at_the_public_internet_is_refused():
    # "Local model" must not become an undocumented remote-provider slot.
    settings = _settings(
        local_base_url="https://api.openai.com/v1",
        model_roles={"prose": {"provider": "local", "model": "gpt-4o"}},
    )
    r = resolve_role_model(settings, None, "prose")
    assert r["usable"] is False
    assert "not a local address" in r["unusable_reason"]


# ── Caveats: it will run, but here is something worth knowing ────────────────

def test_prompt_caching_loss_is_reported_as_a_caveat_not_a_failure():
    settings = _settings(
        nanogpt_api_key="k",
        prompt_caching=True,
        model_roles={"critique": {"provider": "nanogpt", "model": "some/model"}},
    )
    r = resolve_role_model(settings, None, "critique")
    assert r["usable"] is True          # a caveat never blocks the work
    assert "caching" in r["caveat"].lower()
    assert "NanoGPT" in r["caveat"]


def test_a_cache_capable_provider_carries_no_caveat():
    r = resolve_role_model(_settings(), None, "critique")
    assert r["caveat"] is None
