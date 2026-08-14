// features/codex/RunWalk.test.tsx -- the three facts a belief needs
// ==================================================================
// R8.8. Two things are pinned here, and they are different in kind.
//
// The CONTENT contracts are the same sort as the subtext and Unwoven guides:
// this walk exists to teach one thing -- that the programme's own opening
// example takes three facts and not one -- and a version that stopped making
// that argument would not fail a build anywhere else.
//
// The STRUCTURAL one is that GuidedWalk now lives in components/learn/ and is
// used by a Weave surface. It was written as a shared component, said so in its
// own header, and sat inside one feature's folder for its whole life, so the
// second feature to want it would have had to reach across a boundary or copy
// it. Copying is how two walkthroughs end up teaching in two different shapes.
//
// Navigation goes by step TITLE, never by counting clicks.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RunWalk, RUN_WALK_TITLES } from "./RunWalk";

afterEach(() => cleanup());

function open() {
  render(<RunWalk onClose={() => {}} />);
}

/** Show the named step, from a fresh card. Always starts over rather than
 *  walking on from wherever the last call left off -- a relative walk silently
 *  overshoots the moment one test visits two steps. */
function goTo(title: string) {
  const target = RUN_WALK_TITLES.indexOf(title);
  expect(target).toBeGreaterThanOrEqual(0);
  cleanup();
  open();
  for (let i = 0; i < target; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: /next step/i }));
  }
}

describe("the Run walkthrough", () => {
  it("uses the shared card rather than a shape of its own", () => {
    // The structural half of R8.8: GuidedWalk moved to components/learn/ and a
    // Weave surface uses it. If this ever renders something else, the Weave has
    // grown its own second walkthrough shape.
    open();
    expect(screen.getByTestId("guided-walk")).toBeTruthy();
  });

  it("names the mistake before teaching the fix", () => {
    // One fact reading "believes her father died" is the obvious thing to type,
    // and nothing in the app can detect it: the resulting world is perfectly
    // consistent, just not the writer's book.
    goTo("A belief is a fact too, and it is the hard one");
    expect(screen.getByText(/three facts/)).toBeTruthy();
    expect(screen.getByText(/Nothing will warn\s+you/)).toBeTruthy();
  });

  it("teaches all three facts, and what each one is for", () => {
    goTo("First: what she believes, on her own frame");
    expect(screen.getByText(/whose truth this is/i)).toBeTruthy();

    goTo("Second: what actually happened");
    expect(screen.getByText(/must not meet early/)).toBeTruthy();

    goTo("Third: the moment she changes her mind");
    // The one that is easiest to forget, and the consequence stated.
    expect(screen.getByText(/goes on believing him dead forever/)).toBeTruthy();
  });

  it("shows what the brief actually contains, rather than describing it", () => {
    // The demo union is what makes this possible: the audiobook's demos are
    // clips, and there is nothing to listen to in a context brief.
    goTo("Second: what actually happened");
    expect(screen.getByText(/the reader has not been told/)).toBeTruthy();
    expect(screen.getByText(/Her father is alive, in hiding\./)).toBeTruthy();
  });

  it("offers no Play button on something there is nothing to hear", () => {
    // A dead Play button beside a piece of text is the clearest possible way to
    // say the feature does not understand what it is showing.
    goTo("Second: what actually happened");
    expect(screen.queryByRole("button", { name: /^Play:/ })).toBeNull();
  });

  it("says the whole thing is optional", () => {
    // Frames are for a character being wrong on purpose. Most of what a writer
    // records here needs none of this, and a walkthrough that implies otherwise
    // makes the ordinary case feel like a shortcut.
    goTo("What you get for it");
    expect(screen.getByText(/never have to do any of this/)).toBeTruthy();
  });

  it("uses no em dashes anywhere a writer reads", () => {
    render(<RunWalk onClose={() => {}} />);
    for (let i = 0; i < RUN_WALK_TITLES.length; i += 1) {
      expect(document.body.textContent).not.toContain("—");
      expect(document.body.textContent).not.toContain("–");
      const next = screen.queryByRole("button", { name: /next step/i });
      if (next) fireEvent.click(next);
    }
  });

  it("closes from the card and from the last step", () => {
    const onClose = vi.fn();
    render(<RunWalk onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close the walkthrough"));
    expect(onClose).toHaveBeenCalled();

    // The last step's Done, which is the same handler reached the long way.
    cleanup();
    const onDone = vi.fn();
    render(<RunWalk onClose={onDone} />);
    for (let i = 0; i < RUN_WALK_TITLES.length - 1; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: /next step/i }));
    }
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onDone).toHaveBeenCalled();
  });
});
