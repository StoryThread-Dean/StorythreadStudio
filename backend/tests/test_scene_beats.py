# tests/test_scene_beats.py
# ==========================
# Tests for beats: the `## Beats` checklist section at the end of scene
# sidecar files (summaries/scenes/<chapter-stem>/scene-NN.md).
#
# The load-bearing rule pinned here: POST /scene-summary with NO beats
# field must PRESERVE the beats already on disk -- that is the only thing
# protecting beats from being wiped every time the AI regenerates a scene
# summary (the regen path saves through that endpoint with no beats).

from pathlib import Path

from fastapi.testclient import TestClient

from app.routers.documents import Beat, _render_beats_section, _split_beats_section


def _create_project(client: TestClient, tmp_path: Path) -> str:
    folder = tmp_path / "proj"
    folder.mkdir()
    res = client.post("/api/projects/create", json={
        "folder_path": str(folder), "title": "Beats Novel",
    })
    assert res.status_code == 200, res.text
    return res.json()["root_path"]


SCENE_PARAMS = {"chapter_filename": "01-chapter-1.md", "index": 1}


def _save_summary(client: TestClient, root: str, **extra):
    return client.post("/api/documents/scene-summary", json={
        "folder_path": root,
        "chapter_filename": "01-chapter-1.md",
        "index": 1,
        "title": "The Letter",
        "content": "Mira finds the letter on the step.",
        **extra,
    })


def _load_summary(client: TestClient, root: str):
    return client.get("/api/documents/scene-summary", params={
        "folder_path": root, **SCENE_PARAMS,
    })


# ── Parser / renderer round-trip ─────────────────────────────────────────────

def test_split_and_render_round_trip():
    raw = (
        "# The Letter\n\nSummary body.\n"
        "\n## Beats\n\n- [ ] Mira finds the letter\n- [x] Storm cuts the ferry\n"
    )
    base, beats = _split_beats_section(raw)
    assert "## Beats" not in base
    assert "Summary body." in base
    assert beats == [
        Beat(text="Mira finds the letter", done=False),
        Beat(text="Storm cuts the ferry", done=True),
    ]
    # Rendering those beats back produces an equivalent section.
    section = _render_beats_section(beats)
    assert "- [ ] Mira finds the letter" in section
    assert "- [x] Storm cuts the ferry" in section


def test_split_without_beats_section_is_identity():
    raw = "# Scene\n\nJust a body.\n"
    base, beats = _split_beats_section(raw)
    assert base == raw
    assert beats == []


def test_render_empty_beats_is_empty_string():
    assert _render_beats_section([]) == ""
    assert _render_beats_section([Beat(text="   ", done=False)]) == ""


# ── GET strips beats from content ────────────────────────────────────────────

def test_get_returns_beats_and_clean_content(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    res = _save_summary(client, root, beats=[
        {"text": "Find the letter", "done": False},
        {"text": "Reveal the seal", "done": True},
    ])
    assert res.status_code == 200

    data = _load_summary(client, root).json()
    assert data["exists"] is True
    assert data["content"] == "Mira finds the letter on the step."
    assert "## Beats" not in data["content"]
    assert data["beats"] == [
        {"text": "Find the letter", "done": False},
        {"text": "Reveal the seal", "done": True},
    ]


# ── POST beats semantics: None preserves, [] removes ─────────────────────────

def test_save_without_beats_preserves_disk_beats(client: TestClient, tmp_path: Path):
    # Simulates AI regeneration: first save writes beats, second save (new
    # AI summary text, NO beats field) must keep them.
    root = _create_project(client, tmp_path)
    _save_summary(client, root, beats=[{"text": "Keep me", "done": False}])

    res = _save_summary(client, root, content="Regenerated summary text.")
    assert res.status_code == 200

    data = _load_summary(client, root).json()
    assert data["content"] == "Regenerated summary text."
    assert data["beats"] == [{"text": "Keep me", "done": False}]


def test_save_with_empty_beats_removes_section(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _save_summary(client, root, beats=[{"text": "Old beat", "done": False}])

    res = _save_summary(client, root, beats=[])
    assert res.status_code == 200

    data = _load_summary(client, root).json()
    assert data["beats"] == []

    on_disk = (
        Path(root) / "summaries" / "scenes" / "01-chapter-1" / "scene-01.md"
    ).read_text(encoding="utf-8")
    assert "## Beats" not in on_disk


# ── /scene-beats writes only the Beats section ───────────────────────────────

def test_scene_beats_endpoint_preserves_title_and_body(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _save_summary(client, root)

    res = client.post("/api/documents/scene-beats", json={
        "folder_path": root,
        "chapter_filename": "01-chapter-1.md",
        "index": 1,
        "beats": [{"text": "Toggle me", "done": True}],
    })
    assert res.status_code == 200

    data = _load_summary(client, root).json()
    assert data["title"] == "The Letter"
    assert data["content"] == "Mira finds the letter on the step."
    assert data["beats"] == [{"text": "Toggle me", "done": True}]


def test_scene_beats_creates_sidecar_when_missing(client: TestClient, tmp_path: Path):
    # A writer can plan beats before any summary exists.
    root = _create_project(client, tmp_path)

    res = client.post("/api/documents/scene-beats", json={
        "folder_path": root,
        "chapter_filename": "01-chapter-1.md",
        "index": 2,
        "beats": [{"text": "Planned first", "done": False}],
    })
    assert res.status_code == 200

    on_disk = (
        Path(root) / "summaries" / "scenes" / "01-chapter-1" / "scene-02.md"
    ).read_text(encoding="utf-8")
    assert on_disk.startswith("# Scene 2")
    assert "- [ ] Planned first" in on_disk


# ── List endpoint carries beats ──────────────────────────────────────────────

def test_scene_summaries_list_includes_beats(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _save_summary(client, root, beats=[
        {"text": "One", "done": True},
        {"text": "Two", "done": False},
    ])

    res = client.get("/api/documents/scene-summaries", params={
        "folder_path": root, "chapter_filename": "01-chapter-1.md",
    })
    assert res.status_code == 200
    scenes = res.json()
    assert len(scenes) == 1
    assert scenes[0]["beats"] == [
        {"text": "One", "done": True},
        {"text": "Two", "done": False},
    ]
