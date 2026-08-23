// TraitWindow.test.tsx -- saying when a trait is true
// ====================================================
// What this control has to get right is almost entirely about DEFAULTS and
// about saying out loud what it has just done. The mechanism is a checkbox
// list; the risk is a writer discovering weeks later that half a character
// stopped reaching the AI and nothing ever mentioned it.

import { describe, it, expect, vi, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";

import { TraitWindow } from "./TraitWindow";

afterEach(cleanup);

const CHAPTERS = [
  { anchor: "c-1", title: "The Alley" },
  { anchor: "c-2", title: "The Guild" },
  { anchor: "c-3", title: "The Road North" },
  { anchor: "c-4", title: "Ashfall" },
];

function mount(props: Partial<ComponentProps<typeof TraitWindow>> = {}) {
  const onChange = vi.fn();
  render(<TraitWindow chapters={CHAPTERS} onChange={onChange} {...props} />);
  return { onChange };
}

describe("the default", () => {
  it("is true all the way through, with nothing to configure", () => {
    // Every trait ever written is in this state and must stay in it. A control
    // that opened with a chapter list would read as a question the writer has
    // to answer for all six traits on the page.
    mount();
    expect((screen.getByTestId("trait-window-always") as HTMLInputElement)
      .checked).toBe(true);
    expect(screen.queryByTestId("trait-window-picker")).toBeNull();
  });

  it("reads a null window as always, because that is what the wire sends", () => {
    // THE BUG THIS EXISTS FOR, and it shipped. `always` was `trueIn ===
    // undefined`. The profiles/ path returns the backend's Pydantic model
    // straight to the screen and FastAPI writes an unset `true_in` as JSON
    // `null`, so every trait on that path rendered with the switch OFF and the
    // "not sent to AI at all" warning under it. The writer turned it on, saved,
    // and the save's own response turned it back off.
    //
    // Reinstate `=== undefined` above and this test fails; nothing else does.
    mount({ trueIn: null });
    expect((screen.getByTestId("trait-window-always") as HTMLInputElement)
      .checked).toBe(true);
    expect(screen.queryByTestId("trait-window-picker")).toBeNull();
    // And the alarming sentence in particular must not be on screen: a trait
    // nobody has touched is not a trait that has been switched off.
    expect(screen.queryByTestId("trait-window-empty")).toBeNull();
  });

  it("still tells a real empty window apart from an absent one", () => {
    // The other half of the same rule. `[]` is a DECISION -- true nowhere --
    // and the fix above must not have swallowed it into "always".
    mount({ trueIn: [] });
    expect((screen.getByTestId("trait-window-always") as HTMLInputElement)
      .checked).toBe(false);
    expect(screen.getByTestId("trait-window-empty")).toBeTruthy();
  });

  it("explains itself, like every other feature", () => {
    mount();
    expect(within(screen.getByTestId("trait-window"))
      .getByLabelText("What's this?")).toBeTruthy();
  });
});

describe("switching it off", () => {
  it("asks where, and starts with nothing assumed", () => {
    const { onChange } = mount();
    fireEvent.click(screen.getByTestId("trait-window-always"));
    // Not "every chapter ticked", which would read the same today and diverge
    // the moment chapter 5 is written -- the trait would silently stop being
    // true in new work.
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("SAYS the trait is now true nowhere rather than leaving it to be found", () => {
    mount({ trueIn: [] });
    expect(screen.getByTestId("trait-window-empty").textContent)
      .toMatch(/not true anywhere/i);
    expect(screen.queryByTestId("trait-window-summary")).toBeNull();
  });

  it("switching it back on removes the window entirely", () => {
    // `undefined`, not `[]`. An empty list is an answer -- "true nowhere" --
    // and handing it back for "always" would switch the trait off.
    const { onChange } = mount({ trueIn: ["c-1"] });
    fireEvent.click(screen.getByTestId("trait-window-always"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe("picking chapters", () => {
  it("ticks one", () => {
    const { onChange } = mount({ trueIn: [] });
    const rows = within(screen.getByTestId("trait-window-chapters"))
      .getAllByRole("checkbox");
    fireEvent.click(rows[1]);
    expect(onChange).toHaveBeenCalledWith(["c-2"]);
  });

  it("unticks one", () => {
    const { onChange } = mount({ trueIn: ["c-1", "c-2"] });
    const rows = within(screen.getByTestId("trait-window-chapters"))
      .getAllByRole("checkbox");
    fireEvent.click(rows[0]);
    expect(onChange).toHaveBeenCalledWith(["c-2"]);
  });

  it("TICKS THE REST OF THE BOOK FROM ONE CHAPTER, which is the real shape", () => {
    // A trait rarely holds in chapters 3, 7 and 11. It starts being true when
    // something happens and stays true -- so "after her transformation" has to
    // be one click, not eighteen boxes.
    const { onChange } = mount({ trueIn: [] });
    fireEvent.click(screen.getByLabelText("True from The Guild onward"));
    expect(onChange).toHaveBeenCalledWith(["c-2", "c-3", "c-4"]);
  });

  it("says which chapters, in the writer's numbering, with runs collapsed", () => {
    mount({ trueIn: ["c-2", "c-3", "c-4"] });
    expect(screen.getByTestId("trait-window-summary").textContent)
      .toContain("Chapters 2-4");
  });

  it("keeps gaps separate rather than pretending they are a range", () => {
    mount({ trueIn: ["c-1", "c-3"] });
    expect(screen.getByTestId("trait-window-summary").textContent)
      .toContain("Chapters 1, 3");
  });

  it("says one chapter in the singular", () => {
    mount({ trueIn: ["c-1"] });
    expect(screen.getByTestId("trait-window-summary").textContent)
      .toContain("Chapter 1.");
  });
});

describe("a book with nothing in it yet", () => {
  it("says why there is nothing to tick", () => {
    // An empty list with no explanation reads as a broken screen. This is the
    // same rule as the guide that shipped attached to a panel which hid itself
    // in the empty state (R2.12f).
    mount({ trueIn: [], chapters: [],
            unavailable: "No chapters yet. Write one and this trait can be tied to it." });
    expect(screen.getByTestId("trait-window-unavailable").textContent)
      .toMatch(/No chapters yet/);
    expect(screen.queryByTestId("trait-window-chapters")).toBeNull();
  });
});
