# audiobook/speaker_analysis.py -- who says this line? (spec 27.3)
# =================================================================
# The AI reads a passage and PROPOSES which character speaks each piece
# of dialogue. It proposes; it never applies. Every proposal goes to the
# writer, who accepts, reassigns, or keeps the narrator -- and accepting
# only edits the editor buffer, so nothing reaches the file until the
# writer saves, exactly like the Formatting Walkthrough.
#
# The rule this module exists to enforce is stricter than "review before
# apply", though. A language model asked to quote a passage will happily
# paraphrase it, normalize its punctuation, or repair a typo on the way
# past. If the app then wrapped a [voice:...] span around "the text the
# AI said was there", it would be silently editing the writer's prose --
# the one thing the whole product forbids.
#
# So every proposal is VERIFIED against the source text before it is
# offered: the quote must appear in the passage character for character,
# or the proposal is dropped. A dropped proposal costs the writer one
# suggestion. An unverified one costs them their words.

import json
import re

SPEAKER_ANALYSIS_PROMPT = """You identify who is speaking in a passage of fiction, so an audiobook can narrate each character in their own voice.

Return JSON in exactly this shape:

{
  "proposals": [
    {
      "quote": "the dialogue exactly as it appears, including its quotation marks",
      "speaker": "the character's name",
      "confidence": 0.9,
      "reason": "a short phrase naming your evidence"
    }
  ]
}

RULES

1. QUOTE EXACTLY. Copy the dialogue character for character from the passage. Do not fix typos, change punctuation, alter capitalization, or shorten it. If you cannot reproduce it exactly, leave it out.
2. Only spoken dialogue. Narration, description, and interior thought stay with the narrator and must not appear in your proposals.
3. Name the speaker as the passage names them. Use the name the prose uses, not a description ("Elena", never "the woman at the gate").
4. If you cannot tell who is speaking, either leave the line out or give it a confidence below 0.5. Guessing confidently is worse than saying nothing: a wrong voice is heard by every listener.
5. Confidence is 0 to 1. Use the dialogue tag, the surrounding action, and the alternation pattern as evidence; say which in one short phrase.
6. Never use em dash or en dash characters. Use a double hyphen instead.
7. Return only the JSON object. No commentary before or after it.

You are reading, not writing. Do not rewrite, improve, or continue the passage."""


def build_user_message(text: str, known_names: list[str]) -> str:
    """The passage, plus the cast the writer already has.

    Naming the existing cast matters: without it the model invents a new
    spelling for a character who is already in the book ("Elena Vasquez"
    for "Elena"), and every one of those becomes a name the cast does not
    know -- which reads to the writer as the feature not working.
    """
    cast_line = (
        "Characters already in this audiobook's cast: "
        + ", ".join(known_names)
        + ". Prefer these exact names when the passage refers to them.\n\n"
        if known_names else ""
    )
    return (
        f"{cast_line}Identify the speaker of each piece of dialogue in the "
        f"passage below.\n\n--- BEGIN PASSAGE ---\n{text}\n--- END PASSAGE ---"
    )


def _normalize_name(raw: str) -> str:
    """Trim, collapse whitespace, and drop a trailing possessive or
    punctuation the model sometimes carries over ("Elena," / "Elena's")."""
    name = " ".join(str(raw or "").split()).strip()
    name = re.sub(r"['’]s$", "", name)
    return name.strip(" ,.;:\"'").strip()


def verify_proposals(raw_proposals, text: str, max_proposals: int = 60) -> tuple[list[dict], int]:
    """
    Keep only proposals whose quote really is in the passage.

    Returns (kept, dropped_count). Each kept proposal gains `start` and
    `end` offsets into the passage, so the UI can show the real words and
    the editor can wrap exactly them -- never a re-typed copy.

    Overlaps are resolved first-come: two proposals covering the same
    words would produce nested [voice:...] spans, which the parser warns
    about and the writer would have to untangle by hand.
    """
    kept: list[dict] = []
    dropped = 0
    taken: list[tuple[int, int]] = []

    for raw in (raw_proposals or []):
        if len(kept) >= max_proposals:
            break
        if not isinstance(raw, dict):
            dropped += 1
            continue
        quote = str(raw.get("quote") or "")
        speaker = _normalize_name(raw.get("speaker"))
        if not quote.strip() or not speaker:
            dropped += 1
            continue

        # The verification. An AI that paraphrased, "fixed" punctuation,
        # or reflowed whitespace fails here, and its proposal is dropped
        # rather than applied to words the writer never wrote.
        start = text.find(quote)
        if start < 0:
            dropped += 1
            continue
        end = start + len(quote)
        if any(start < t_end and t_start < end for t_start, t_end in taken):
            dropped += 1
            continue
        taken.append((start, end))

        try:
            confidence = float(raw.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0
        kept.append({
            "quote": quote,
            "speaker": speaker,
            "confidence": max(0.0, min(1.0, confidence)),
            "reason": str(raw.get("reason") or "").strip(),
            "start": start,
            "end": end,
        })

    kept.sort(key=lambda p: p["start"])
    return kept, dropped


def parse_response(raw_text: str, text: str) -> tuple[list[dict], int]:
    """Model output -> verified proposals. Unparseable output yields no
    proposals rather than an error: a failed analysis is a feature that
    found nothing, not a broken workspace."""
    try:
        parsed = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError):
        return [], 0
    if not isinstance(parsed, dict):
        return [], 0
    return verify_proposals(parsed.get("proposals"), text)
