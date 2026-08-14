// features/codex/UnwovenGuide.test.tsx -- what the ground-rules walkthrough promises
// ===================================================================================
// R6.4's second half. The board says how much of a world is undecided; this
// says why a novelist mid-draft should care, which is the question that decides
// whether the pass gets used at all.
//
// These are contracts about the CONTENT, in the same spirit as the subtext
// guide's tests: a walkthrough that stops making its argument is not a broken
// build, it is a quietly worse feature, which is exactly the rot a suite is for.
//
// Navigation goes by page TITLE, never by counting clicks. A count breaks the
// moment a page is inserted, and the resulting failure tells you nothing.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { UnwovenGuide, UNWOVEN_GUIDE_TITLES } from "./UnwovenGuide";

afterEach(() => cleanup());

/** Walk forward until the named page is showing. */
function goTo(title: string) {
  const target = UNWOVEN_GUIDE_TITLES.indexOf(title);
  expect(target).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < target; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
  }
}

function open() {
  render(<UnwovenGuide onClose={() => {}} />);
}

describe("the ground rules walkthrough", () => {
  it("opens by saying this pass is not about mistakes", () => {
    // The single most important thing it can establish, and it has to be first.
    // Every other pass finds something wrong; a writer who arrives expecting
    // that reads a hundred open questions as a hundred failures.
    open();
    expect(screen.getByText(/not about mistakes/i)).toBeTruthy();
    expect(screen.getByText(/never have to finish it/)).toBeTruthy();
  });

  it("argues from a cost, not from tidiness", () => {
    // "Your world will be more complete" is not a reason anybody acts on.
    // "You will otherwise decide this in chapter nineteen in a way that
    // contradicts chapter four" is.
    open();
    goTo("Why it is worth answering at all");
    expect(screen.getByText(/chapter nineteen/)).toBeTruthy();
    expect(screen.getByText(/contradicts chapter four/)).toBeTruthy();
  });

  it("shows a real question with its reason attached", () => {
    // The reason is the load-bearing half. A prompt on its own is homework.
    open();
    goTo("A question, and what makes it answerable");
    expect(screen.getByText(/how is the next one decided/i)).toBeTruthy();
    expect(screen.getByText(/motive the moment somebody gets ill/)).toBeTruthy();
  });

  it("says an answer can be a sentence, and that skipping is free", () => {
    open();
    goTo("A question, and what makes it answerable");
    expect(screen.getByText(/can be answered in a sentence/)).toBeTruthy();
    expect(screen.getByText(/Skipping costs nothing/)).toBeTruthy();
  });

  it("says where the answer lands and what that buys", () => {
    // The difference between this pass and a notes file, stated as capability
    // rather than as architecture.
    open();
    goTo("Your answer goes somewhere real");
    expect(screen.getByText(/becomes an entry in your world/)).toBeTruthy();
    expect(screen.getByText(/An answer that lands nowhere is a note/)).toBeTruthy();
  });

  it("teaches that answering opens more questions, and frames it as the point", () => {
    // Otherwise the first writer who answers three questions and gets five back
    // concludes the feature is broken or endless.
    open();
    goTo("Answering one question opens the ones it implies");
    expect(screen.getByText(/which raises this/)).toBeTruthy();
    expect(screen.getByText(/is the feature/)).toBeTruthy();
    expect(screen.getByText(/not a list growing longer/)).toBeTruthy();
  });

  it("says crosslinks never block anything", () => {
    open();
    goTo("And it reaches into other parts of your world");
    expect(screen.getByText(/never block anything/)).toBeTruthy();
  });

  it("shows the same beat written with and without the ground decided", () => {
    // The proof. Everything before this page is an argument; this page is the
    // thing a writer can judge for themselves.
    open();
    goTo("What it changes in the writing");
    expect(screen.getByText("Before")).toBeTruthy();
    expect(screen.getByText("After")).toBeTruthy();
    expect(screen.getByText(/Nothing was added to the plot/)).toBeTruthy();
  });

  it("explains why a sitting is short and what the board is for", () => {
    open();
    goTo("One question at a time, one part at a time");
    expect(screen.getByText(/a dozen questions/)).toBeTruthy();
    expect(screen.getByText(/counts on the board are real/)).toBeTruthy();
  });

  it("distinguishes not yet from never ask this", () => {
    // Two answers that look alike and are not, and the walk records them
    // differently and permanently. A writer who confuses them retires a
    // question they meant to defer.
    open();
    goTo("The two answers that are not answers");
    expect(screen.getByText(/returns next time/)).toBeTruthy();
    expect(screen.getByText(/retires it\s+for good/)).toBeTruthy();
    expect(screen.getByText(/Retiring one moves the next question up/)).toBeTruthy();
  });

  it("ends by saying answering nothing is allowed", () => {
    // The honest close. This pass invents work by design, so it has to be the
    // one that says out loud that the work is optional.
    open();
    goTo("Where to start");
    expect(screen.getByText(/your book is not worse for it/)).toBeTruthy();
  });

  it("uses no em dashes anywhere a writer reads", () => {
    // The locked product rule, checked across every page rather than the one
    // that happens to be open.
    render(<UnwovenGuide onClose={() => {}} />);
    for (let i = 0; i < UNWOVEN_GUIDE_TITLES.length; i += 1) {
      expect(document.body.textContent).not.toContain("—");
      expect(document.body.textContent).not.toContain("–");
      const next = screen.queryByRole("button", { name: /next/i });
      if (next) fireEvent.click(next);
    }
  });

  it("closes from the last page and from the corner", () => {
    const onClose = vi.fn();
    render(<UnwovenGuide onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();

    cleanup();
    const onDone = vi.fn();
    render(<UnwovenGuide onClose={onDone} />);
    goTo(UNWOVEN_GUIDE_TITLES[UNWOVEN_GUIDE_TITLES.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onDone).toHaveBeenCalled();
  });
});
