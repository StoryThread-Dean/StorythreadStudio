// InsertWalkthrough.test.tsx
// ===========================
// The walkthrough panel's contract: stops walk in order from the start
// offset, Apply commits the proposal through onApplyEdit (buffer edit,
// never a save), Skip advances without touching text, per-kind muting
// filters the walk, marker repairs replace in place, and Ctrl+Enter is
// the keyboard fast path.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render, screen, fireEvent, cleanup, waitFor, within,
} from "@testing-library/react";

import { InsertWalkthrough } from "./InsertWalkthrough";

// Word-reading stops render each candidate pronunciation as audio. The
// render itself belongs to the local narrator; what this file checks is
// what gets SENT -- the writer's own sentence with one reading applied.
const previewSelection = vi.fn(async () => ({
  blob: new Blob(["wav"]), warnings: [], trace: [],
}));
// The guided walk plays before/after beat demos through the same cached
// backend endpoint the marker help uses.
const fetchMarkerDemo = vi.fn(async () => new Blob(["wav"]));
vi.mock("./api", () => ({
  previewSelection: (...args: unknown[]) => previewSelection(...(args as [])),
  fetchMarkerDemo: (...args: unknown[]) => fetchMarkerDemo(...(args as [])),
}));

/** Walk the guided tutorial forward until the named step is showing.
 *  Navigating by TITLE rather than by a click count -- a hardcoded count
 *  breaks every time a step is inserted, which is exactly what happened
 *  when the dialogue step was split in two.
 *
 *  Pass the bare title; the step number is added here. Several step
 *  titles are also mute-checkbox labels in the strip behind the card
 *  ("Marker problems", "Word readings"), and matching those would let the
 *  walk stop on step one and silently assert nothing. */
function walkToStep(title: string) {
  const heading = new RegExp(`^\\d+\\. ${title}`);
  for (let i = 0; i < 25; i += 1) {
    if (screen.queryByText(heading)) return;
    const next = screen.queryByLabelText("Next step");
    if (!next) break;
    fireEvent.click(next);
  }
  expect(screen.getByText(heading)).toBeTruthy();
}
// jsdom has no audio device; play() would reject and noise up the run.
window.HTMLMediaElement.prototype.play = vi.fn(async () => {});
window.HTMLMediaElement.prototype.pause = vi.fn();
if (!("createObjectURL" in URL)) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:clip") });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

const TEXT = 'She made a decision. "A cult." Lexa nodded. [pace:=2]Fast bit.[/pace]';

function renderPanel(overrides: Partial<Parameters<typeof InsertWalkthrough>[0]> = {}) {
  const props = {
    content: TEXT,
    startOffset: 0,
    onApplyEdit: vi.fn(),
    onHighlight: vi.fn(),
    onClose: vi.fn(),
    workspacePath: "C:/books/mine",
    voiceId: "am_michael",
    ...overrides,
  };
  render(<InsertWalkthrough {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InsertWalkthrough", () => {
  it("walks stops in order and highlights the current one", () => {
    const props = renderPanel();
    expect(screen.getByText(/stop 1 of/)).toBeTruthy();
    // First stop: the narration-to-dialogue hand-off after "decision."
    expect(screen.getByText("Narration hands off to dialogue")).toBeTruthy();
    expect(props.onHighlight).toHaveBeenCalledWith(
      TEXT.indexOf(".") + 1, 0);
  });

  it("Apply commits the default proposal as a buffer edit", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Pause 0\.4s/ }).closest("button")!);
    expect(props.onApplyEdit).toHaveBeenCalledOnce();
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain('She made a decision. [pause:0.4] "A cult."');
    // Progress reflects the applied count.
    expect(screen.getByText(/1 applied/)).toBeTruthy();
  });

  it("Skip advances without editing", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(props.onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/stop 2 of/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/stop 1 of/)).toBeTruthy();
  });

  it("muting a trigger kind removes its stops from the walk", () => {
    renderPanel();
    const total = screen.getByText(/stop 1 of (\d+)/).textContent!;
    fireEvent.click(screen.getByRole("checkbox", { name: /Before dialogue/ }));
    expect(screen.queryByText("Narration hands off to dialogue")).toBeNull();
    expect(screen.getByText(/stop 1 of (\d+)/).textContent).not.toBe(total);
  });

  it("marker repairs replace the broken marker in place", () => {
    const props = renderPanel();
    // Walk to the broken [pace:=2] stop.
    while (!screen.queryByText(/Unreadable pace value/)) {
      fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Fix to \[pace:\+2\]/ }));
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain("[pace:+2]Fast bit.[/pace]");
    expect(next).not.toContain("[pace:=2]");
  });

  it("Ctrl+Enter applies the default from anywhere", () => {
    const props = renderPanel();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(props.onApplyEdit).toHaveBeenCalledOnce();
  });

  it("Escape closes the walkthrough", () => {
    const props = renderPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("Auto-apply requires a confirm, applies beats, leaves repairs manual", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Add all \d+ pauses at once/ }));
    // The warning strip appears; nothing applied yet.
    expect(screen.getByText(/wrong for the scene/i)).toBeTruthy();
    expect(props.onApplyEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Yes, add all/ }));
    expect(props.onApplyEdit).toHaveBeenCalledOnce();
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain('She made a decision. [pause:0.4] "A cult."');
    expect(next).toContain("[pace:=2]");           // repair NOT auto-fixed
    // The walk continues with the repair as the remaining stop.
    expect(screen.getByText(/Unreadable pace value/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add all \d+ pauses/ })).toBeNull();
  });

  it("Keep walking cancels the auto-apply confirm", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Add all \d+ pauses at once/ }));
    fireEvent.click(screen.getByRole("button", { name: /let me go one at a time/ }));
    expect(props.onApplyEdit).not.toHaveBeenCalled();
    expect(screen.queryByText(/wrong for the scene/i)).toBeNull();
  });

  it("says so plainly when there is nothing to suggest", () => {
    renderPanel({ content: "# Heading\n\nOne long ordinary paragraph of prose without any dialogue at all in it." });
    expect(screen.getByText(/nothing to suggest/i)).toBeTruthy();
  });

  it("offers a way out when the walk has nothing left", () => {
    // As a strip this just went quiet. As a window it would be an empty
    // box, and the writer would reasonably assume something broke.
    renderPanel({ content: "# Heading\n\nOne long ordinary paragraph of prose without any dialogue at all in it." });
    expect(screen.getByText(/starts at your cursor/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

// ── The pop-out shell (user decision, 2026-08-03) ─────────────────────────────

describe("InsertWalkthrough as a window", () => {
  it("is a dialog, and the backdrop closes it", () => {
    const props = renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Formatting Walkthrough" });
    expect(dialog).toBeTruthy();
    fireEvent.click(dialog);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("does not close when a click lands inside the panel", () => {
    // Clicking the backdrop is a deliberate gesture; clicking a control
    // and losing the walk is a bug.
    const props = renderPanel();
    fireEvent.click(screen.getByText(/Narration hands off to dialogue/));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("says what each kind is FOR, not just how many there are", () => {
    // A count beside a label the writer cannot interpret is a toggle they
    // will never touch. The rail has room for a reason.
    renderPanel();
    expect(screen.getByText(/breath before someone starts speaking/))
      .toBeTruthy();
    expect(screen.getByText(/Typos in your markers/)).toBeTruthy();
    expect(screen.getByText(/Words with two sounds: read, wound, close, bow/))
      .toBeTruthy();
  });

  it("shows the whole paragraph, not a 90-character window", () => {
    // The panel covers the editor, so the context in here is the only
    // context there is. Deciding a beat needs the sentence around it.
    const long = "He waited by the door for a long time, listening to the "
      + "house settle around him and counting the seconds. She left. "
      + "No word. No note. Nothing at all to go on.";
    renderPanel({ content: long });
    expect(screen.getByText(/listening to the\s+house settle around him/))
      .toBeTruthy();
  });

  it("keeps the paragraph it is working in, and does not spill into the next", () => {
    const text = "She left. No word. No note at all.\n\nThe second paragraph "
      + "is somewhere else entirely and has no business in this box.";
    renderPanel({ content: text });
    expect(screen.queryByText(/no business in this box/)).toBeNull();
  });
  it("opens by saying this is optional and naming what it fixes", async () => {
    // Trunk before branches. Step one has to establish three things
    // before any specific stop is mentioned: none of this is required,
    // the narrator has real faults, and this screen exists to fix them.
    // A writer who does not know that is being asked to tune something
    // they were never told was broken.
    renderPanel();
    expect(screen.queryByText(/None of this is required/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    expect(screen.getByText(/1\. What this is for/)).toBeTruthy();
    expect(screen.getByText(/None of this is required/)).toBeTruthy();
    // Names the engine and owns its faults rather than implying the
    // writer's text is the problem.
    expect(screen.getByText(/called Kokoro/)).toBeTruthy();
    expect(screen.getByText(/it has real faults/)).toBeTruthy();

    // And the walk itself is still there underneath it -- the card
    // explains the panel, it does not replace it.
    expect(screen.getByText(/Formatting Walkthrough/)).toBeTruthy();
  });

  it("the guided walk explains marker repairs as repairs, not suggestions", async () => {
    // A mistyped marker either does nothing or swallows the chapter --
    // worth doing even by a writer who skips every other stop.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Fixes");
    expect(screen.getByText(/These are not suggestions/)).toBeTruthy();
  });

  it("gives every beat kind its own step with before/after audio", () => {
    // The kinds are audible, so describing them is the weakest option
    // available. Each one gets the same two-button A/B shape that made
    // word readings work: one sentence, played both ways.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    for (const title of ["Before dialogue", "After dialogue",
                         "Short-sentence beats", "Interjections"]) {
      walkToStep(title);
      expect(screen.getByLabelText(/Play: No pause/)).toBeTruthy();
      expect(screen.getByLabelText(/Play: With a/)).toBeTruthy();
    }
  });

  it("teaches what a pause IS before naming any place to put one", () => {
    // Trunk, then branches. The pause tile comes before the dialogue
    // tiles and is deliberately NOT about dialogue -- it is about the
    // marker and its three lengths, which are otherwise just numbers on
    // three buttons the writer is asked to choose between.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("What a pause does");
    expect(screen.getByLabelText("Play: No pause")).toBeTruthy();
    expect(screen.getByLabelText(/Short pause, 0.4 seconds/)).toBeTruthy();
    expect(screen.getByLabelText(/Long pause, 1.5 seconds/)).toBeTruthy();
    // Not a word about dialogue in THIS card; that is the next tile's
    // job. Scoped to the card, because "Before dialogue" is also a label
    // in the rail behind it.
    const card = screen.getByTestId("guided-walk");
    expect(within(card).queryByText(/dialogue/i)).toBeNull();
  });

  it("names the two ways to use it before explaining either", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Two ways to use it");
    expect(screen.getByText(/One at a time/)).toBeTruthy();
    expect(screen.getByText(/All at once/)).toBeTruthy();
    // And says which to start with, rather than leaving it to the reader.
    expect(screen.getByText(/Start with one at a time/)).toBeTruthy();
  });

  it("runs one continuous scene through the beat tiles", () => {
    // The same argument in order, so by the third clip the writer is
    // judging the pause instead of reading a new sentence.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Before dialogue");
    expect(screen.getByText(/Listen to Elena losing her temper/)).toBeTruthy();
    walkToStep("After dialogue");
    expect(screen.getByText(/Elena\s+has finished her line/)).toBeTruthy();
    walkToStep("Short-sentence beats");
    expect(screen.getByText(/Still the same scene/)).toBeTruthy();
  });

  it("admits the short-burst suggestion is a matter of taste", () => {
    // Sometimes the faster version is better. A tutorial that claims
    // every suggestion is an improvement gets disbelieved on the first
    // one the writer disagrees with.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Short-sentence beats");
    expect(screen.getByText(/Sometimes the faster version is better/)).toBeTruthy();
    expect(screen.getByText(/drum beat/)).toBeTruthy();
  });

  it("gives word readings their own two Play buttons", () => {
    // The strongest demo in the set: the first clip is not a matter of
    // taste, it is the narrator saying the wrong word.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Word readings");
    expect(screen.getByLabelText(/Play: Wrong: the narrator says "reed"/)).toBeTruthy();
    expect(screen.getByLabelText(/Play: Fixed: the narrator says "red"/)).toBeTruthy();
  });

  it("calls the repair tile Fixes, and never a problem with your file", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Fixes");
    expect(screen.queryByText(/Marker problems/)).toBeNull();
  });

  it("explains the left list and the all-at-once button in plain words", () => {
    // This tile was rewritten from scratch: "Turn kinds off, or do the
    // beats in one go" needed five readings to parse, and none of the
    // words in it meant anything to a first-time writer.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Choosing what it suggests");
    expect(screen.getByText(/The list on the left/)).toBeTruthy();
    expect(screen.getByText(/Untick\s+anything you do not want to be asked about/))
      .toBeTruthy();
    // Says what it will NOT do, which is the part that protects the book.
    expect(screen.getByText(/will never do for you/)).toBeTruthy();
  });

  it("has no tutorial step for the keyboard shortcuts", () => {
    // They moved out of the tutorial and under the buttons they
    // duplicate: reference belongs beside the thing it describes, not on
    // equal footing with why the feature exists.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    for (let i = 0; i < 25; i += 1) {
      const next = screen.queryByLabelText("Next step");
      if (!next) break;
      fireEvent.click(next);
    }
    expect(screen.queryByText(/^\d+\. Keyboard/)).toBeNull();
  });

  it("shows the shortcuts as quiet text under the buttons", () => {
    renderPanel();
    expect(screen.getByText(/Ctrl\+Enter adds the first choice/)).toBeTruthy();
  });

  it("plays a beat demo through the cached backend endpoint", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Short-sentence beats");
    fireEvent.click(screen.getByLabelText(/Play: No pause/));
    await waitFor(() => expect(fetchMarkerDemo)
      .toHaveBeenCalledWith("beat-short-burst-flat"));
    // Replaying is free: the clip is cached, so no second request.
    fireEvent.click(screen.getByLabelText(/Play: No pause/));
    await waitFor(() => expect(fetchMarkerDemo).toHaveBeenCalledTimes(1));
  });

  it("says the paragraph gap already covers dialogue in its own paragraph", () => {
    // Otherwise a writer hand-places 550ms the pipeline inserts for them,
    // and wonders why the walk went quiet on paragraph-leading dialogue.
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Before dialogue");
    expect(screen.getByText(/already get a pause automatically/)).toBeTruthy();
  });
});

// ── Word readings (spec 18.6) ─────────────────────────────────────────────────
// The one part of narration no explanation can settle in the abstract:
// which "read" this is. The stop's whole job is to make that a two-second
// listening decision instead of a spelling argument.

const READ_TEXT = "Yesterday I read the letter twice, then folded it away.";

describe("InsertWalkthrough word readings", () => {
  it("asks which reading is meant and offers each one as audio", () => {
    renderPanel({ content: READ_TEXT });
    expect(screen.getByText('Which "read" is this?')).toBeTruthy();
    // The engine's own reading is named as a SOUND, so the writer knows
    // what they are comparing against.
    expect(screen.getByText(/will say "reed" here/)).toBeTruthy();
    // One Play per reading -- the point of the design.
    expect(screen.getByLabelText('Play "present tense"')).toBeTruthy();
    expect(screen.getByLabelText('Play "past tense"')).toBeTruthy();
  });

  it("pre-selects nothing -- only the writer knows which sense they meant", () => {
    renderPanel({ content: READ_TEXT });
    // A beat stop leads with a highlighted default; a reading stop must
    // not, or the walk is guessing at the meaning of the sentence.
    expect(screen.queryByTitle("Apply (Ctrl+Enter)")).toBeNull();
    // And the keyboard fast path stays inert here for the same reason.
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(screen.getByText('Which "read" is this?')).toBeTruthy();
  });

  it("says plainly that the engine's own reading needs no marker", () => {
    renderPanel({ content: READ_TEXT });
    expect(screen.getByText(/already how it reads -- Skip keeps it/)).toBeTruthy();
    // Exactly one reading is applicable, so exactly one Use this exists.
    expect(screen.getAllByRole("button", { name: "Use this" })).toHaveLength(1);
  });

  it("plays the writer's own sentence with the reading applied", async () => {
    renderPanel({ content: READ_TEXT });
    fireEvent.click(screen.getByLabelText('Play "past tense"'));
    await waitFor(() => expect(previewSelection).toHaveBeenCalled());
    const [workspace, text, voice] = previewSelection.mock.calls[0] as unknown as
      [string, string, string];
    expect(workspace).toBe("C:/books/mine");
    expect(voice).toBe("am_michael");
    // The sentence, not a carrier phrase and not a bare word: which
    // reading is right depends on the sentence, so the sentence is what
    // has to be heard.
    expect(text).toContain("Yesterday I");
    expect(text).toContain("[say:red]read[/say]");
  });

  it("plays the word untouched for the engine's own reading", async () => {
    renderPanel({ content: READ_TEXT });
    fireEvent.click(screen.getByLabelText('Play "present tense"'));
    await waitFor(() => expect(previewSelection).toHaveBeenCalled());
    const text = (previewSelection.mock.calls[0] as unknown as string[])[1];
    expect(text).toContain("I read the letter");
    expect(text).not.toContain("[say:");
  });

  it("caches a clip so replaying it costs nothing", async () => {
    renderPanel({ content: READ_TEXT });
    fireEvent.click(screen.getByLabelText('Play "past tense"'));
    await waitFor(() => expect(previewSelection).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Play "past tense"'));
    await waitFor(() => expect(previewSelection).toHaveBeenCalledTimes(1));
  });

  it("applies the chosen reading as a buffer edit, wrapping that word only", () => {
    const props = renderPanel({ content: READ_TEXT });
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(props.onApplyEdit).toHaveBeenCalledTimes(1);
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toBe(
      "Yesterday I [say:red]read[/say] the letter twice, then folded it away.");
    // Manual save still owns persistence -- this is typing, not saving.
    expect(next.match(/\[say:/g)).toHaveLength(1);
  });

  it("never stops on a word the writer already settled", () => {
    // Re-walking a chapter must not re-ask about spots that carry an
    // override, or every pass would pile a second wrapper on the first.
    renderPanel({
      content: "Yesterday I [say:red]read[/say] the letter twice.",
    });
    expect(screen.queryByText('Which "read" is this?')).toBeNull();
  });

  it("counts the same word ahead instead of offering to apply in bulk", () => {
    // The next "read" may be the other sense entirely, so nothing is
    // batched -- but the writer should know the walk continues rather
    // than wonder whether it caught them all.
    renderPanel({
      content: "I read it yesterday. She likes to read at night. They read on.",
    });
    expect(screen.getByText(/2 more "read"/)).toBeTruthy();
    expect(screen.queryByText(/Set for the rest/)).toBeNull();
  });

  it("keeps rare senses out of the walk until asked for", () => {
    // "does" the female deer against "does" the verb: right nearly every
    // time, so it ships muted rather than deleted.
    renderPanel({ content: "She does everything herself, every day." });
    expect(screen.queryByText(/Which "does" is this\?/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Rare word readings/));
    expect(screen.getByText('Which "does" is this?')).toBeTruthy();
  });

  it("the guided walk explains the SOUND, not the buttons", () => {
    // A writer has no reason to trust "reed / red" as notation. What the
    // help has to land is why their ear is the instrument here.
    renderPanel({ content: READ_TEXT });
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    walkToStep("Word readings");
    expect(screen.getByText(/Word readings -- let your ear decide/)).toBeTruthy();
    expect(screen.getByText(/guesses wrong more often than not/)).toBeTruthy();
    expect(screen.getByText(/right answer\s+most of the time/))
      .toBeTruthy();
  });

  it("excludes word readings from Auto-apply", () => {
    // Auto-apply exists to spare the writer the beat work. A meaning
    // choice is not beat work, and applying one unasked would put a wrong
    // pronunciation in the book under the writer's own name.
    renderPanel({
      content: 'I read it yesterday. "A cult." Lexa nodded. Short. Bits here.',
    });
    const auto = screen.getByRole("button", { name: /Add all \d+ pauses at once/ });
    fireEvent.click(auto);
    expect(screen.getByText(/Marker fixes and word readings are not\s+included/)).toBeTruthy();
  });
});
