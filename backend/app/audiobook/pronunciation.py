# audiobook/pronunciation.py -- pronunciation rules + TTS payload prep.
# ======================================================================
# Fantasy names are the classic audiobook landmine: "Kaelith" can come out
# five different ways. A pronunciation rule maps displayed text to spoken
# text ("Kaelith" -> "KAY-lith"), and the substitution happens ONLY in the
# text sent to a speech provider. The narration copy on screen is never
# rewritten -- same principle as the em dash rules below.
#
# Scopes (from the spec, revised 2026-07-28):
#   "audiobook"  -- applies throughout this audiobook (workspace file)
#   "all"        -- applies in every audiobook (app-level file)
#   One-spot overrides are NOT dictionary entries -- a position-anchored
#   rule breaks as soon as the writer edits upstream text. They are inline
#   [say:KAY-lith]Kaelith[/say] markers in the narration copy itself, which
#   survive external editing and hash naturally with the text. Legacy
#   "occurrence" entries in old files load as audiobook scope.
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
    scope: str = "audiobook"            # audiobook | all
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
        # Unknown scopes -- including legacy "occurrence" entries from
        # before the [say] marker design -- fall back to audiobook scope.
        scope = entry.get("scope") if entry.get("scope") in ("audiobook", "all") else "audiobook"
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
    Rules that apply to whole-text substitution: the workspace's rules plus
    the app-level "all" rules. Workspace rules come FIRST so a per-book
    rule wins over a global one for the same word (first substitution
    consumes the match). One-spot overrides are inline [say] markers, not
    rules -- they are resolved before any rule runs (see prepare_tts_text).
    """
    ws = list(load_workspace_rules(workspace_path))
    global_only = [r for r in load_global_rules() if r.scope == "all"]
    return ws + global_only


def apply_pronunciations(text: str, rules: list[PronunciationRule]) -> str:
    """
    Whole-word substitution of display_text -> spoken_text. Word boundaries
    keep "Kae" from mauling "Kaelith"; re.escape keeps punctuation in a
    rule ("Dr. Vex") from becoming accidental regex. The spoken form goes
    in SPEAKABLE (caps-for-stress flattened) -- this function only ever
    feeds provider payloads, never the screen.
    """
    out = text
    for rule in rules:
        pattern = re.compile(
            r"\b" + re.escape(rule.display_text) + r"\b",
            0 if rule.case_sensitive else re.IGNORECASE,
        )
        out = pattern.sub(speakable(rule.spoken_text), out)
    return out


# ── Making spoken forms actually speakable ────────────────────────────────────
# Writers type phonetic respellings the standard way: caps for the
# stressed syllable, hyphens between syllables ("LAR-uh", "KAY-lith").
# Two engine behaviors fight that convention (both measured live):
#   1. A caps RUN inside a word is read as letters, even mid-word and
#      even fused: bare-word durations put "LARah" (0.92s) with the
#      letter-spelled baseline "L A R ah" (0.98s), far from "larah"
#      (0.72s); "absoLOOTlee" shows the same failure mid-word. So caps
#      syllables lowercase. (A 2026-07-30 backtrack briefly preserved
#      caps after a sentence-carrier test suggested they added stress --
#      bare-word measurement disproved it: the "extra dwell" WAS the
#      letter-spelling. Caps are not a stress dial on this engine.)
#   2. A syllable boundary rendered as a space (or kept as a hyphen)
#      becomes a word boundary -- an audible hesitation ("Lar... a") --
#      so hyphenated syllables FUSE into one word: "LAR-ah" -> "larah".
# Spaces the writer actually typed ("Doctor Vex") remain word breaks.
# The dictionary file and everything on screen keep the writer's spelling.

def speakable(spoken: str) -> str:
    words_out = []
    for word in spoken.strip().split():
        syllables = []
        for syllable in word.split("-"):
            # Only flatten chunks that LOOK like shouted syllables
            # (letters, all caps, 2+ chars). Mixed case ("McRae") passes.
            if len(syllable) >= 2 and syllable.isalpha() and syllable.isupper():
                syllables.append(syllable.lower())
            else:
                syllables.append(syllable)
        words_out.append("".join(syllables))
    return " ".join(w for w in words_out if w)


# ── Inline [say] overrides ────────────────────────────────────────────────────
# [say:KAY-lith]Kaelith[/say] -- the writer's one-spot pronunciation
# override, living IN the narration text (text is the source of truth).
# The payload gets the spoken form; every display path shows the original.
_SAY_RE = re.compile(r"\[say:([^\]]+)\](.*?)\[/say\]", re.IGNORECASE | re.DOTALL)


def resolve_say_markers(text: str) -> str:
    """Payload side: replace each [say] span with its SPEAKABLE spoken form."""
    return _SAY_RE.sub(lambda m: speakable(m.group(1)), text)


def strip_say_markers(text: str) -> str:
    """Display side: drop the markup, keep the original displayed word."""
    return _SAY_RE.sub(lambda m: m.group(2), text)


# ' -- ' (and bare '--') become a true em dash in the payload. A speech
# engine treats an em dash as natural mid-sentence punctuation; '--' it may
# read out loud. The narration file itself keeps whatever the writer wrote.
_DOUBLE_HYPHEN_RE = re.compile(r"\s*--\s*")


def normalize_for_tts(text: str) -> str:
    return _DOUBLE_HYPHEN_RE.sub("—", text)


def prepare_tts_text(text: str, rules: list[PronunciationRule]) -> str:
    """
    The payload-preparation pipeline for one piece of narration text, in
    the spec's fixed order:

      1. [say] inline overrides   (the writer's explicit word always wins)
      2. pronunciation rules      (written against what the writer SEES)
      3. verbalization            (numbers/romans/abbreviations -- arrives
                                   with the generation stage; slot reserved)
      4. punctuation normalization ('--' to em dash)

    Display text elsewhere is never changed by design.

    A final guard runs last: any MARKER-SHAPED token still standing is
    removed. By this point the parser has already turned every real
    marker into structure, so anything left is a stray -- an unmatched
    [/say] from a selection that clipped one, say. The engine has no
    idea it is a marker and reads it out: a lone [/say] became an
    audible "slash" mid-sentence (live finding). No marker should ever
    be spoken, and this is the one place that can promise it. Only
    recognised shapes are stripped, so a writer's own square brackets
    survive.
    """
    from app.audiobook.markers import strip_all_markers

    prepared = normalize_for_tts(
        apply_pronunciations(resolve_say_markers(text), rules))
    return strip_all_markers(prepared).strip()
