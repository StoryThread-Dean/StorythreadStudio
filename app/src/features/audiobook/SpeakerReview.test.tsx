// SpeakerReview.test.tsx
// =======================
// The AI proposal walk. What is tested here is restraint: the pass has
// an opinion about the writer's prose, and every path out of that
// opinion has to go through the writer.
//
//   Accept wraps the REAL words (offsets into the analysed text), never
//   a re-typed copy of them.
//   Keep narrator advances without touching anything.
//   A proposal whose text has moved cannot be applied at all -- wrapping
//   blind would put a marker around the wrong sentence.
//   Low confidence is shown, not hidden. A model that is unsure is
//   useful; a model that hides being unsure is a trap.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { SpeakerReview } from "./SpeakerReview";
import type { SpeakerProposal } from "./api";

const TEXT = 'The gate stood open.\n\n"This cannot continue," Elena said.\n';

function proposal(over: Partial<SpeakerProposal> = {}): SpeakerProposal {
  const quote = '"This cannot continue,"';
  return {
    quote, speaker: "Elena", confidence: 0.92, reason: "dialogue tag",
    start: TEXT.indexOf(quote), end: TEXT.indexOf(quote) + quote.length,
    in_cast: true,
    ...over,
  };
}

function renderReview(props: Partial<Parameters<typeof SpeakerReview>[0]> = {}) {
  const onAccept = vi.fn();
  const onClose = vi.fn();
  render(
    <SpeakerReview
      proposals={[proposal()]}
      dropped={0}
      analyzedText={TEXT}
      onAccept={onAccept}
      onClose={onClose}
      {...props}
    />,
  );
  return { onAccept, onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SpeakerReview", () => {
  it("shows the line, the speaker, and how sure the model is", async () => {
    renderReview();
    expect(screen.getByText('"This cannot continue,"')).toBeTruthy();
    expect(screen.getByText(/confident \(92%\)/)).toBeTruthy();
    expect(screen.getByText(/dialogue tag/)).toBeTruthy();
  });

  it("names low confidence instead of burying it", async () => {
    renderReview({ proposals: [proposal({ confidence: 0.3 })] });
    expect(screen.getByText(/unsure \(30%\)/)).toBeTruthy();
  });

  it("flags a speaker who is not in the cast yet", async () => {
    renderReview({ proposals: [proposal({ speaker: "Marcus", in_cast: false })] });
    expect(screen.getByText(/Marcus is not in your cast yet/)).toBeTruthy();
  });

  it("Accept passes the proposal and the name actually shown", async () => {
    // The writer can correct the name before accepting -- that is the
    // spec's [Change Speaker], done in place rather than as a third
    // button.
    const { onAccept } = renderReview();
    fireEvent.change(screen.getByLabelText("Speaker name"),
                     { target: { value: "Elena Vasquez" } });
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0][1]).toBe("Elena Vasquez");
    expect(onAccept.mock.calls[0][0].quote).toBe('"This cannot continue,"');
  });

  it("Keep narrator advances without applying anything", async () => {
    const { onAccept } = renderReview({
      proposals: [proposal(), proposal({ speaker: "Marcus" })],
    });
    expect(screen.getByText(/Speaker 1 of 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Keep narrator/ }));
    expect(screen.getByText(/Speaker 2 of 2/)).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("cannot apply a proposal whose text has moved", async () => {
    // Offsets are only meaningful against the text they were computed
    // on. Wrapping blind would put a voice marker around whatever now
    // sits at those positions.
    const { onAccept } = renderReview({
      analyzedText: "Something else entirely, rewritten while the panel was open.",
    });
    expect(screen.getByText(/text changed since this was analysed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Accept/ }) as HTMLButtonElement)
      .disabled).toBe(true);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("an empty name cannot be accepted", async () => {
    renderReview();
    fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: /Accept/ }) as HTMLButtonElement)
      .disabled).toBe(true);
  });

  it("says that nothing is saved until Save", async () => {
    // The whole promise of the pass: an unconvincing result costs one
    // undo, or simply closing without saving.
    renderReview();
    expect(screen.getByText(/nothing is saved until you press Save/)).toBeTruthy();
  });

  it("reports discarded suggestions rather than looking like it found nothing", async () => {
    renderReview({ proposals: [], dropped: 3 });
    expect(screen.getByText(/3 suggestions did not match your text exactly/))
      .toBeTruthy();
  });

  it("counts what it added when the walk is done", async () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    expect(screen.getByText(/1 voice marker added to the editor/)).toBeTruthy();
  });

  it("says it is working while the pass runs", async () => {
    renderReview({ busy: true, proposals: [] });
    expect(screen.getByText(/working out who speaks/)).toBeTruthy();
  });
});
