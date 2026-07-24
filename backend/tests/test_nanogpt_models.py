# tests/test_nanogpt_models.py -- Generic model-list normalization
# ==================================================================
# Non-OpenRouter providers publish thin, inconsistent /models catalogs.
# _normalize_generic_models() (app/ai/openrouter.py) is deliberately
# tolerant: it accepts several response shapes, several id field names,
# and silently skips malformed entries instead of raising. These tests
# lock in that tolerance and the honest defaults for missing data
# (unknown pricing is NOT "free"; no reasoning toggle without evidence).

from app.ai.openrouter import _normalize_generic_models


def test_normalizes_data_wrapper_shape():
    # NanoGPT's documented shape: {"data": [{id, name, context_length}]}
    raw = {"data": [
        {"id": "vendor/model-a", "name": "Model A", "context_length": 32000},
        {"id": "vendor/model-b"},
    ]}
    models = _normalize_generic_models(raw)
    assert [m["id"] for m in models] == ["vendor/model-a", "vendor/model-b"]
    a = models[0]
    assert a["name"] == "Model A"
    assert a["context_length"] == 32000
    # Model B had no name -- falls back to the id.
    assert models[1]["name"] == "vendor/model-b"


def test_normalizes_models_wrapper_and_bare_array():
    # Some servers use {"models": [...]}, others return a bare JSON array.
    wrapped = _normalize_generic_models({"models": [{"id": "m1"}]})
    bare    = _normalize_generic_models([{"id": "m1"}])
    assert [m["id"] for m in wrapped] == ["m1"]
    assert [m["id"] for m in bare] == ["m1"]


def test_id_fallback_chain_and_skip_malformed():
    raw = {"data": [
        {"name": "only-name"},          # id from "name"
        {"model": "only-model"},        # id from "model"
        {"context_length": 4096},       # no usable id -> skipped
        "not-a-dict",                   # wrong type -> skipped
    ]}
    models = _normalize_generic_models(raw)
    assert sorted(m["id"] for m in models) == ["only-model", "only-name"]


def test_defaults_are_honest_about_missing_data():
    m = _normalize_generic_models({"data": [{"id": "x"}]})[0]
    # Costs must be floats for ModelInfo, but unknown pricing is NOT free.
    assert m["cost_input_per_million"] == 0.0
    assert m["cost_output_per_million"] == 0.0
    assert m["is_free"] is False
    # Text output assumed so the text-only filter passes.
    assert m["output_modalities"] == ["text"]
    # No moderation data and no reasoning evidence -> both False.
    assert m["is_moderated"] is False
    assert m["supports_reasoning"] is False
    assert m["context_length"] == 0


def test_unrecognized_payload_returns_empty_list():
    assert _normalize_generic_models("garbage") == []
    assert _normalize_generic_models({"unexpected": True}) == []
    assert _normalize_generic_models(None) == []


def test_result_sorted_by_name():
    raw = {"data": [{"id": "z", "name": "Zeta"}, {"id": "a", "name": "alpha"}]}
    models = _normalize_generic_models(raw)
    assert [m["name"] for m in models] == ["alpha", "Zeta"]
