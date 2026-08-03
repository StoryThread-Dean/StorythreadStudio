"""
Audition the heteronym table against the REAL engine (spec 18.6).

Why this exists
---------------
`app/src/features/audiobook/heteronyms.ts` claims two things about every
word it ships: that the engine reads one sense WRONG, and that the
respelling beside it lands on the right sound. Both claims are checkable
without listening to anything, because espeak-ng -- the exact
grapheme-to-phoneme step Kokoro uses -- is sitting inside the local
narrator's virtual environment. This script asks it.

It is a FILTER, not a verdict. `[say:Thee]` phonemizes correctly to the
right sound and still came back from the model sounding like "neh"
(spec 18.5), so phonemes right does not mean audio right. What this
catches, cheaply and in bulk, is the respellings that never had a chance:
the ones that split into two words, leak a phoneme, or change nothing.
The writer's ear settles the rest, one Play button at a time.

How to run it (from the repo root)
----------------------------------
    kokoro-worker/.venv/Scripts/python.exe scripts/audition-heteronyms.py

The worker's venv is the one with espeak-ng in it; the backend
deliberately has no phonemizer (it would drag native libraries into the
frozen sidecar). Set PYTHONIOENCODING=utf-8 on Windows or the IPA output
will not print.

What the output means
---------------------
  says X / wants Y   the engine's reading in that sense's own sentence,
                     against the reading the respelling produces
  SPLITS             a mid-word capital -- espeak emits TWO words, the
                     single biggest failure in the candidate table
  AUDIBLE-H          the silent-h vowel trick leaked a real /h/
  NO-CHANGE          the respelling produces exactly what the engine
                     already says, so the row is a no-op

Rerun this after any worker version bump. A new espeak changes the
answers, and a shipped table nobody re-auditioned is a table of guesses.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

try:
    import phonemizer
    from kokoro_onnx.tokenizer import Tokenizer
    from phonemizer.separator import Separator
except ImportError:
    sys.exit(
        "This script needs the local narrator's virtual environment, which "
        "is where espeak-ng lives:\n"
        "    kokoro-worker/.venv/Scripts/python.exe scripts/audition-heteronyms.py"
    )

# speakable() is the real payload path: it fuses hyphens into one word and
# lowercases caps RUNS. Auditioning the raw respelling instead of this
# would judge a string the engine never sees.
from app.audiobook.pronunciation import speakable  # noqa: E402

TOKENIZER = Tokenizer()          # also wires espeak's bundled library in
WORD_SEP = Separator(word="|", phone="")
PUNCTUATION = ".,;:!?—–\"'“” "

# ── The table under audition ──────────────────────────────────────────────────
# word -> sense -> (respelling or None for "the engine's own reading",
#                   sentences that put the word in that sense)
# Two sentences per sense wherever possible: one odd construction can fool
# a POS tagger, and a single sample would hide that.
CASES: dict[str, list[tuple[str, str | None, list[str]]]] = {
    "read": [
        ("present tense", None, ["I read every evening by the fire.",
                                 "They read in silence each night."]),
        ("past tense", "red", ["I read it yesterday and burned it.",
                               "She read the letter twice, then folded it."]),
    ],
    "dove": [
        ("the bird", None, ["The dove would not fly.",
                            "A dove settled on the sill."]),
        ("past tense of dive", "dohv", ["He dove into the black water.",
                                        "She dove for the rope."]),
    ],
    "wound": [
        ("an injury", None, ["He nursed the wound in silence."]),
        ("past tense of wind", "wow-nd", ["She wound the cord around her hand.",
                                          "He wound the watch and set it down."]),
    ],
    "close": [
        ("near", None, ["Stand close to me.", "He kept close to the wall."]),
        ("to shut", "klohz", ["Close the door.", "She had to close the shutters."]),
    ],
    "lead": [
        ("to guide", None, ["She will lead the group through the pass."]),
        ("the metal", "led", ["The pipe contains lead.",
                              "He tasted lead in the water."]),
    ],
    "bow": [
        ("the weapon, or a ribbon", None, ["He carried a bow and a quiver."]),
        ("to bend forward", "bau", ["Bow before the queen.",
                                    "The servants bow when she enters."]),
    ],
    "bowed": [
        ("bent forward", None, ["He bowed politely and left."]),
        ("curved out of true", "bohd", ["The board was bowed by the damp."]),
    ],
    "row": [
        ("a line, or to row a boat", None, ["A row of black windows faced them.",
                                            "We row out past the point."]),
        ("an argument", "rau", ["They had a terrible row about it.",
                                "The row lasted until dawn."]),
    ],
    "wind": [
        ("moving air", None, ["The wind came off the sea."]),
        ("to twist or turn", "wined", ["Wind the clock before bed.",
                                       "You must wind the rope tighter."]),
    ],
    "bass": [
        ("the low musical range", None, ["He played bass in a cellar band."]),
        ("the fish", "bas", ["He landed a bass at dawn.",
                             "The bass swam under the dock."]),
    ],
    "sow": [
        ("to plant seed", None, ["They sow the field in April."]),
        ("a female pig", "sau", ["The sow lay in the mud.",
                                 "A sow and her litter blocked the lane."]),
    ],
    "aged": [
        ("became older", None, ["The wine aged well in the cellar.",
                                "He aged ten years that season."]),
        ("elderly", "aijid", ["An aged man opened the door.",
                              "The aged servant said nothing."]),
    ],
    "blessed": [
        ("past tense", None, ["The priest blessed them at the door."]),
        ("holy or fortunate", "blessid", ["A blessed event, she called it.",
                                          "The blessed quiet of the morning."]),
    ],
    "beloved": [
        ("a loved person", None, ["Her beloved returned in spring."]),
        ("dearly loved (describing)", "beluvvid", ["A beloved author signed it."]),
    ],
    "dogged": [
        ("persistent", None, ["Dogged determination got him there."]),
        ("followed persistently", "dogd", ["They dogged him through the market.",
                                           "Rumor dogged her for years."]),
    ],
    "moped": [
        ("the small motorbike", None, ["A moped coughed past the gate."]),
        ("sulked", "mohpt", ["He moped all day about it.",
                             "She moped near the window."]),
    ],
    # ── rare senses (shipped muted) ───────────────────────────────────────────
    "does": [
        ("a form of do", None, ["She does everything herself."]),
        ("female deer", "dohz", ["Two does watched from the treeline.",
                                 "The does scattered at the sound."]),
    ],
    "minute": [
        ("sixty seconds", None, ["Wait a minute longer."]),
        ("extremely small", "mynoot", ["A minute crack ran up the glass."]),
    ],
    "use": [
        ("the noun", None, ["It has no use to anyone now."]),
        ("the verb", "yooz", ["Use this tool instead.", "They use the back stair."]),
    ],
    "live": [
        ("to reside", None, ["They live nearby.", "We live above the shop."]),
        ("happening now, or carrying current", "lyve",
         ["It is a live broadcast.", "The wire is still live."]),
    ],
    "axes": [
        ("the chopping tools", None, ["The axes hung above the hearth."]),
        ("more than one axis", "akseez", ["Both axes were labelled in ink."]),
    ],
    "sewer": [
        ("the waste pipe", None, ["The sewer ran under the street."]),
        ("a person who sews", "sower", ["The sewer bit off the thread."]),
    ],
}

# Senses the engine gets wrong that NO respelling reaches, kept here so the
# report says so out loud instead of leaving a silent gap. The whole
# noun/verb stress family lives here: its only lever is a capital letter,
# and a mid-word capital makes espeak emit two separate words.
KNOWN_UNFIXABLE = {
    "record, object, project, present, produce, protest, permit, rebel, "
    "survey, suspect, conduct, conflict, contest, contract, contrast, "
    "convert, convict, insult, export, import, impact, implant, imprint, "
    "incense, entrance, console, desert, digest, exploit, extract, "
    "frequent, perfect, prefix, refill, refund, replay, compound, "
    "commune, compact, compress, increase, decrease, august, invalid":
        "noun/verb stress pairs -- stress must move to the second syllable, "
        "and the only lever (a capital) splits the word in two. A weak-vowel "
        "respelling does work for some (record -> rekord); each needs its own "
        "hunt, so the family is deferred to its own pass.",
    "separate, moderate, estimate, deliberate, alternate, intimate, "
    "appropriate, associate, aggregate, elaborate, duplicate, advocate, "
    "graduate, predicate":
        "the -ate family, same stress problem as above.",
    "tear, tears, house, learned, abuse, crooked, jagged, ragged, naked, "
    "polish, mobile, lives":
        "the engine already reads BOTH senses correctly -- verified. "
        "Stopping on these would be a tax for a miss that does not happen.",
}


def strip_punctuation(text: str) -> str:
    return text.strip(PUNCTUATION)


def reading_in_context(sentence: str, target: str) -> str | None:
    """The target word's phonemes as spoken INSIDE this sentence.

    The word separator is what makes this possible: without it the
    phonemes arrive as one run with no way to tell which belong to which
    word. When the counts do not line up we return None rather than guess
    -- a wrong alignment would be a confident lie.
    """
    out = phonemizer.phonemize(
        sentence, "en-us", preserve_punctuation=True, with_stress=True,
        separator=WORD_SEP, strip=True)
    words = re.findall(r"[A-Za-z']+", sentence)
    groups = [g for g in out.split("|") if g.strip()]
    if len(groups) != len(words):
        return None
    for word, group in zip(words, groups):
        if word.lower() == target.lower():
            return strip_punctuation(group)
    return None


def respelling_faults(respelling: str) -> list[str]:
    """The mechanical disqualifiers, each one measured rather than assumed."""
    payload = speakable(respelling)
    phonemes = TOKENIZER.phonemize(payload)
    faults = []
    if " " in phonemes.strip():
        faults.append("SPLITS")
    body = phonemes.lstrip("ˈ")
    if "h" in body[1:]:
        faults.append("AUDIBLE-H")
    return faults


def main() -> int:
    problems = 0
    print("Auditioning", len(CASES), "words against espeak-ng\n")

    for word, senses in CASES.items():
        print(word)
        engine_default = None
        for sense, respelling, sentences in senses:
            readings = {reading_in_context(s, word) for s in sentences}
            readings.discard(None)
            in_context = " / ".join(sorted(readings)) or "(alignment failed)"
            if respelling is None:
                engine_default = in_context
                print(f"   {sense:<36} engine says {in_context}")
                if len(readings) > 1:
                    print("      note: the engine is INCONSISTENT across "
                          "sentences here, so the miss is intermittent")
                continue

            wanted = strip_punctuation(TOKENIZER.phonemize(speakable(respelling)))
            faults = respelling_faults(respelling)
            if wanted == engine_default:
                faults.append("NO-CHANGE")
            flag = ("  <<< " + " ".join(faults)) if faults else ""
            print(f"   {sense:<36} engine says {in_context}"
                  f"  [say:{respelling}] gives {wanted}{flag}")
            if faults:
                problems += 1
        print()

    print("=" * 74)
    print("NOT SHIPPED, and why")
    print("=" * 74)
    for words, reason in KNOWN_UNFIXABLE.items():
        print(f"\n  {words}\n     -> {reason}")

    print("\n" + "=" * 74)
    if problems:
        print(f"{problems} respelling(s) failed the mechanical gate. Fix or "
              "drop them before shipping.")
        return 1
    print("Every shipped respelling clears the mechanical gate. The ear "
          "decides the rest -- walk a chapter and Play each reading.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
