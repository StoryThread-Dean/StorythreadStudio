# audiobook/pronunciation.py -- pronunciation rules + TTS payload prep.
# ======================================================================
# Fantasy names are the classic audiobook landmine: "Kaelith" can come out
# five different ways. A pronunciation rule maps displayed text to spoken
# text ("Kaelith" -> "KAY-lith"), and the substitution happens ONLY in the
# text sent to a speech provider. The narration copy on screen is never
# rewritten -- same principle as the em dash rules below.
#
# Scopes (from the spec):
#   "audiobook"  -- applies throughout this audiobook (workspace file)
#   "all"        -- applies in every audiobook (app-level file)
#   "occurrence" -- one specific spot; STORED today, APPLIED in the
#                   generation stage once segments exist to anchor to.
#
# House-rule interactions (spec section "Text Normalization"):
#   - The sanitizer never touches narration text -- it is the writer's own
#     manuscript, em dashes included.
#   - Storythread-authored ' -- ' (the house substitute) IS normalized to a
#     real em dash in the provider payload only, so voices read it as
#     natural punctuation instead of saying "dash dash".

import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

# App-level rules file for scope="all". Module-level so tests can
# monkeypatch it away from the real ~/.storythread (same pattern as
# names_store.NAMES_DB).
GLOBAL_RULES_PATH = Path.home() / ".storythread" / "audiobook-pronunciations.json"


@dataclass
class PronunciationRule:
    display_text: str
    spoken_text: str
    scope: str = "audiobook"            # audiobook | all | occurrence
    case_sensitive: bool = False


def _rules_from_raw(raw: object) -> list[PronunciationRule]:
    """Tolerant loader: skip malformed entries instead of failing the file."""
    rules: list[PronunciationRule] = []
    if not isinstance(raw, list):
        return rules
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        display = str(entry.get("display_text") or "").strip()
        spoken = str(entry.get("spoken_text") or "").strip()
        if not display or not spoken:
            continue
        scope = entry.get("scope") if entry.get("scope") in ("audiobook", "all", "occurrence") else "audiobook"
        rules.append(PronunciationRule(
            display_text=display,
            spoken_text=spoken,
            scope=scope,
            case_sensitive=bool(entry.get("case_sensitive", False)),
        ))
    return rules


def _load_file(path: os.PathLike | str) -> list[PronunciationRule]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return _rules_from_raw(json.load(f))
    except (OSError, json.JSONDecodeError):
        return []                        # missing or corrupt file = no rules


def _save_file(path: os.PathLike | str, rules: list[PronunciationRule]) -> None:
    os.makedirs(os.path.dirname(str(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in rules], f, indent=2, ensure_ascii=False)


def workspace_rules_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, "manuscript", "pronunciation-dictionary.json")


def load_workspace_rules(workspace_path: str) -> list[PronunciationRule]:
    return _load_file(workspace_rules_path(workspace_path))


def save_workspace_rules(workspace_path: str, rules: list[PronunciationRule]) -> None:
    _save_file(workspace_rules_path(workspace_path), rules)


def load_global_rules() -> list[PronunciationRule]:
    return _load_file(GLOBAL_RULES_PATH)


def save_global_rules(rules: list[PronunciationRule]) -> None:
    _save_file(GLOBAL_RULES_PATH, rules)


def effective_rules(workspace_path: str) -> list[PronunciationRule]:
    """
    Rules that apply to whole-text substitution right now: the workspace's
    audiobook-scope rules plus the app-level "all" rules. Workspace rules
    come FIRST so a per-book rule wins over a global one for the same word
    (first substitution consumes the match). Occurrence-scope rules are
    excluded until the generation stage can anchor them to segments.
    """
    ws = [r for r in load_workspace_rules(workspace_path) if r.scope in ("audiobook", "all")]
    global_only = [r for r in load_global_rules() if r.scope == "all"]
    return ws + global_only


def apply_pronunciations(text: str, rules: list[PronunciationRule]) -> str:
    """
    Whole-word substitution of display_text -> spoken_text. Word boundaries
    keep "Kae" from mauling "Kaelith"; re.escape keeps punctuation in a
    rule ("Dr. Vex") from becoming accidental regex.
    """
    out = text
    for rule in rules:
        pattern = re.compile(
            r"\b" + re.escape(rule.display_text) + r"\b",
            0 if rule.case_sensitive else re.IGNORECASE,
        )
        out = pattern.sub(rule.spoken_text, out)
    return out


# ' -- ' (and bare '--') become a true em dash in the payload. A speech
# engine treats an em dash as natural mid-sentence punctuation; '--' it may
# read out loud. The narration file itself keeps whatever the writer wrote.
_DOUBLE_HYPHEN_RE = re.compile(r"\s*--\s*")


def normalize_for_tts(text: str) -> str:
    return _DOUBLE_HYPHEN_RE.sub("—", text)


def prepare_tts_text(text: str, rules: list[PronunciationRule]) -> str:
    """
    The full payload-preparation step for one piece of narration text:
    pronunciation substitutions first (rules were written against what the
    writer SEES), then punctuation normalization. Display text elsewhere is
    never changed by design.
    """
    return normalize_for_tts(apply_pronunciations(text, rules))
