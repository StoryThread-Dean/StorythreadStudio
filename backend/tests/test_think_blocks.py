# tests/test_think_blocks.py -- reasoning traces never reach the writer
# =====================================================================
# Local reasoning models (DeepSeek-R1 distills, QwQ and friends) write
# their working out into the ordinary reply body rather than into a
# separate field the way hosted services do. Two things go wrong if it is
# left there: the writer reads the model muttering to itself, and the
# muttering gets stored in the conversation history and fed back on every
# later turn -- growing the prompt and teaching the model to keep doing it.
#
# The stripping is gated on the provider flag, which matters in the other
# direction too: a writer discussing HTML with a hosted model must be able
# to type a tag without the app eating their example.

from app.ai.providers import LOCAL, OPENROUTER
from app.ai.sanitizer import strip_think_blocks


def test_a_complete_block_is_removed():
    text = "<think>The user wants a scene. Let me consider.</think>She opened the door."
    assert strip_think_blocks(text) == "She opened the door."


def test_two_blocks_are_removed_without_swallowing_what_is_between():
    # A greedy regex would take everything from the first opener to the last
    # closer, deleting "Keep this." along with the reasoning.
    text = "<think>first</think>Keep this.<think>second</think>And this."
    assert strip_think_blocks(text) == "Keep this.And this."


def test_an_unterminated_block_takes_everything_after_it():
    # Happens when a reply is cut off by a token limit mid-thought. What
    # follows is all reasoning, so leaving it would show the writer half an
    # internal monologue.
    text = "Here is the line.\n<think>Now let me reconsider whether"
    assert strip_think_blocks(text) == "Here is the line."


def test_a_multiline_block_is_removed():
    text = "<think>\nline one\nline two\n</think>\n\nThe real answer."
    assert strip_think_blocks(text) == "The real answer."


def test_tags_with_attributes_are_matched():
    assert strip_think_blocks('<think type="internal">x</think>Answer') == "Answer"


def test_a_stray_closing_tag_is_left_alone():
    # Far likelier to be prose ABOUT markup than a broken trace, and eating
    # the writer's own words is the worse failure.
    text = "She wrote </think> on the whiteboard."
    assert strip_think_blocks(text) == text


def test_text_with_no_trace_is_untouched():
    text = "Just an ordinary reply, with a -- dash and <em>markup</em>."
    assert strip_think_blocks(text) == text


def test_only_local_providers_are_flagged_for_stripping():
    # The gate itself. Hosted services keep reasoning in a separate field,
    # so running this on their replies could only ever damage real text.
    assert LOCAL.strip_think_blocks is True
    assert OPENROUTER.strip_think_blocks is False
