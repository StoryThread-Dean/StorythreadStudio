# tests/test_names_store.py -- Name Generator data + store guardrails
# =====================================================================
# Two layers:
#   1. CONTENT CONTRACTS against the real shipped JSON (counts, era
#      honesty, no em dashes) -- the seed data is the product here, so the
#      tests audit it like code.
#   2. STORE BEHAVIOR (seed/reseed, fallback walk, "any" union) against
#      the real data in an isolated tmp database.

import json

import pytest

from app.utils import names_store
from app.utils.names_store import ERA_ORDER, get_pool, list_cultures, seed_names_db


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def isolated_names_db(tmp_path, monkeypatch):
    """Point the store at a throwaway DB so the developer's real
    ~/.storythread/names.db is never touched (settings_store pattern)."""
    monkeypatch.setattr(names_store, "NAMES_DIR", tmp_path)
    monkeypatch.setattr(names_store, "NAMES_DB", tmp_path / "names.db")
    return tmp_path


def _load_all_cultures() -> list[dict]:
    cultures = []
    for path in sorted(names_store._data_dir().glob("*.json")):
        with open(path, encoding="utf-8") as f:
            cultures.extend(json.load(f))
    return cultures


# ── Content contracts (the shipped JSON is the product) ─────────────────────

def test_roster_is_complete():
    ids = {c["id"] for c in _load_all_cultures()}
    expected = {
        "british", "irish", "german", "french", "spanish", "italian",
        "greek", "scandinavian", "slavic_russian",
        "egyptian", "turkish", "west_african",
        "japanese", "chinese", "indian",
        "american_south", "american_northeast", "american_west",
        "mexican", "peruvian",
    }
    assert ids == expected


def test_given_name_buckets_meet_the_floor():
    # Target ~30 per gender per era; HARD FLOOR 20 (approximate-less-when-
    # thin is allowed by design, but never below the floor).
    for c in _load_all_cultures():
        for era, genders in c["given"].items():
            assert era in ERA_ORDER, f"{c['id']}: unknown era {era}"
            for gender in ("male", "female"):
                names = genders.get(gender, [])
                assert len(names) >= 20, f"{c['id']}/{era}/{gender}: only {len(names)}"
                assert len(set(names)) == len(names), f"{c['id']}/{era}/{gender}: duplicates"


def test_surname_pools_meet_the_floor():
    # Target ~50 per pool; HARD FLOOR 30.
    for c in _load_all_cultures():
        assert c["surnames"], f"{c['id']}: no surname pools"
        for era, names in c["surnames"].items():
            assert era in (*ERA_ORDER, "any"), f"{c['id']}: unknown surname era {era}"
            assert len(names) >= 30, f"{c['id']}/surnames/{era}: only {len(names)}"
            assert len(set(names)) == len(names), f"{c['id']}/surnames/{era}: duplicates"


def test_era_honesty_no_faked_medieval_americas():
    # America/Mexico/Peru as cultures begin in the colonial bucket -- a
    # pre-1700 "American South" name list would be invented history.
    by_id = {c["id"]: c for c in _load_all_cultures()}
    for cid in ("american_south", "american_northeast", "american_west", "mexican", "peruvian"):
        assert "medieval" not in by_id[cid]["given"], f"{cid} must not declare medieval"
    # European cultures carry all five.
    for cid in ("british", "german", "french", "italian"):
        assert set(by_id[cid]["given"].keys()) == set(ERA_ORDER)


def test_turkish_surnames_are_era_bucketed():
    # Turkey had no fixed surnames before the 1934 Surname Law -- the
    # pools must reflect that split rather than serve modern names as
    # medieval ones.
    by_id = {c["id"]: c for c in _load_all_cultures()}
    turkish = by_id["turkish"]["surnames"]
    assert "medieval" in turkish and "any" in turkish


def test_no_em_or_en_dashes_anywhere():
    for path in sorted(names_store._data_dir().glob("*.json")):
        raw = path.read_text(encoding="utf-8")
        assert "—" not in raw, f"em dash in {path.name}"
        assert "–" not in raw, f"en dash in {path.name}"


# ── Store behavior ───────────────────────────────────────────────────────────

def test_seed_and_list_cultures():
    seed_names_db()
    cultures = list_cultures()
    assert len(cultures) == 20
    # Grouped ordering: rows arrive sorted by region so the frontend can
    # build optgroups with a single pass.
    regions = [c["region"] for c in cultures]
    assert regions == sorted(regions)


def test_exact_era_pool():
    seed_names_db()
    names, used = get_pool("british", "given", "medieval", "female")
    assert used == "medieval"
    assert len(names) >= 20


def test_fallback_walks_to_nearest_era():
    seed_names_db()
    # American South has no medieval bucket: the walk lands on colonial
    # (nearest later era) and reports it.
    names, used = get_pool("american_south", "given", "medieval", "male")
    assert used == "colonial"
    assert len(names) >= 20


def test_surname_any_bucket_serves_specific_eras():
    seed_names_db()
    # A culture with a single "any" surname pool serves it for any era.
    names, used = get_pool("french", "surname", "early20")
    assert used == "any"
    assert len(names) >= 30


def test_any_era_unions_and_dedupes():
    seed_names_db()
    per_era_total = 0
    union_names, used = get_pool("british", "given", "any", "male")
    assert used == "any"
    for era in ERA_ORDER:
        names, _ = get_pool("british", "given", era, "male")
        per_era_total += len(names)
    # Union is at least one era's worth and no larger than the sum
    # (popular names legitimately recur across eras -- William).
    assert len(union_names) <= per_era_total
    assert len(set(union_names)) == len(union_names)
    assert len(union_names) >= 20


def test_any_gender_mixes_pools():
    seed_names_db()
    male, _ = get_pool("japanese", "given", "current", "male")
    both, _ = get_pool("japanese", "given", "current", "any")
    assert len(both) > len(male)


def test_empty_seed_never_stamps_success(tmp_path, monkeypatch):
    # The real-world failure this guards: the backend started once while
    # the data files were missing (mid-install, bad bundle -- or, as it
    # actually happened, a dev reload racing the data authoring). A version
    # stamp on an empty DB would mean "seeded, skip forever" and the Name
    # Generator would silently show only Fantasy races.
    real_data_dir = names_store._data_dir
    empty_dir = tmp_path / "no-data"
    empty_dir.mkdir()
    monkeypatch.setattr(names_store, "_data_dir", lambda: empty_dir)
    seed_names_db()
    assert list_cultures() == []

    # Data appears (install completes) -> the next startup seeds for real.
    monkeypatch.setattr(names_store, "_data_dir", real_data_dir)
    seed_names_db()
    assert len(list_cultures()) == 20


def test_reseed_on_version_bump(monkeypatch):
    seed_names_db()
    before = len(list_cultures())
    assert before == 20
    # Simulate an app update shipping new data: version bump forces reload.
    monkeypatch.setattr(names_store, "SEED_VERSION", "test-bump")
    seed_names_db()
    assert len(list_cultures()) == before
