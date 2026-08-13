// features/codex/DomainBoard.test.tsx -- the whole world, seen at once
// =====================================================================
// R6.4. Unwoven was a drip: a bounded handful of questions with no way to see
// what they were a handful OF. Three things a writer could not do, all of them
// the same missing screen -- tell four questions left from ninety, choose to
// spend an evening on their religion, or see that they had FINISHED a part of
// their world, because a finished domain simply stopped appearing.
//
// These tests are about what the board says, not how it looks. The counts are
// load-bearing: they are the only place the writer learns that the dozen
// questions in front of them are a dozen out of a hundred.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Renders accumulate in this suite otherwise, and every getByText that
// matches a domain label starts finding three of them.
afterEach(() => cleanup());

import { DomainBoard } from "./DomainBoard";
import type { WorldDomain } from "./weavingApi";

function domains(): WorldDomain[] {
  return [
    { id: "governance", label: "Power and who holds it", open: 7, asked_now: 2 },
    { id: "religion", label: "Belief and the sacred", open: 4, asked_now: 1 },
    { id: "language", label: "Language and naming", open: 0, asked_now: 0 },
  ];
}

describe("the domain board", () => {
  it("shows every part of the world with what is left in it", () => {
    render(<DomainBoard domains={domains()} chosen={null} onChoose={() => {}} onShowGuide={() => {}} />);
    expect(screen.getByText("Power and who holds it")).toBeTruthy();
    expect(screen.getByText("Belief and the sacred")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("keeps a finished part on the board rather than dropping it", () => {
    // Dropping it would make the writer's own progress invisible, which is
    // one of the three things this screen exists for.
    render(<DomainBoard domains={domains()} chosen={null} onChoose={() => {}} onShowGuide={() => {}} />);
    expect(screen.getByText("Language and naming")).toBeTruthy();
    expect(screen.getByText(/1 part is fully decided/)).toBeTruthy();
  });

  it("says how much is open in total", () => {
    // The number that turns a dozen questions from "the list" into "some of
    // the list".
    render(<DomainBoard domains={domains()} chosen={null} onChoose={() => {}} onShowGuide={() => {}} />);
    expect(screen.getByText("11 still open")).toBeTruthy();
  });

  it("says nothing here is wrong", () => {
    // Unwoven is the one pass that finds absence rather than mistakes. A
    // hundred open questions is alarming read as a backlog and unalarming read
    // as a world with room in it, and the difference is this sentence.
    render(<DomainBoard domains={domains()} chosen={null} onChoose={() => {}} onShowGuide={() => {}} />);
    expect(screen.getByText(/Nothing here is wrong or overdue/)).toBeTruthy();
    expect(screen.getByText(/never have to decide all of them/)).toBeTruthy();
  });

  it("picks a part to work on", () => {
    const onChoose = vi.fn();
    render(<DomainBoard domains={domains()} chosen={null} onChoose={onChoose} onShowGuide={() => {}} />);
    fireEvent.click(screen.getByText("Belief and the sacred"));
    expect(onChoose).toHaveBeenCalledWith("religion");
  });

  it("lets the same part be picked again to go back to all of it", () => {
    const onChoose = vi.fn();
    render(<DomainBoard domains={domains()} chosen="religion" onChoose={onChoose} onShowGuide={() => {}} />);
    fireEvent.click(screen.getByText("Belief and the sacred"));
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it("says what choosing a part did, and how to undo it", () => {
    render(<DomainBoard domains={domains()} chosen="religion" onChoose={() => {}} onShowGuide={() => {}} />);
    const note = screen.getByTestId("board-chosen");
    expect(note.textContent).toContain("Belief and the sacred");
    expect(note.textContent).toMatch(/Choose it again to go back/);
  });

  it("explains itself", () => {
    // The product rule. A screen with counts on it and no answer to "why am I
    // being asked any of this" is where Unwoven reads as homework.
    render(<DomainBoard domains={domains()} chosen={null} onChoose={() => {}} onShowGuide={() => {}} />);
    expect(screen.getByRole("button", { name: /what's this/i })).toBeTruthy();
  });

  it("renders nothing at all when there is no board to show", () => {
    // Every other pass sends an empty list, and an empty heading is worse than
    // no heading.
    const { container } = render(
      <DomainBoard domains={[]} chosen={null} onChoose={() => {}} onShowGuide={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

// ── The walkthrough it offers (R6.4) ─────────────────────────────────────────
//
// The R2.12f lesson, applied before it can be repeated: a guide that hangs off
// a surface which hides itself is documentation, not help. The board is on
// screen whenever the Unwoven pass is chosen, including for a world with
// nothing answered yet, so the offer is always visible.

describe("the walkthrough", () => {
  it("is offered from the board", () => {
    const onShowGuide = vi.fn();
    render(<DomainBoard domains={domains()} chosen={null}
                        onChoose={() => {}} onShowGuide={onShowGuide} />);
    fireEvent.click(screen.getByText("Show me how this works"));
    expect(onShowGuide).toHaveBeenCalled();
  });

  it("is offered even when nothing has been answered yet", () => {
    const empty: WorldDomain[] = [
      { id: "war", label: "War and violence", open: 10, asked_now: 1 },
    ];
    render(<DomainBoard domains={empty} chosen={null}
                        onChoose={() => {}} onShowGuide={() => {}} />);
    expect(screen.getByText("Show me how this works")).toBeTruthy();
  });
});
