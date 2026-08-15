// features/codex/PlaceStop.test.tsx -- the offer half of declared presence
// =========================================================================
// The scan reads the manuscript for free and can see which chapters name an
// entry. This card asks whether to record it.
//
// The property worth protecting is the line between OFFERING and DECIDING.
// Presence is authored data -- R8.5 deleted `codex_mention` because presence
// derived from the manuscript and cached goes silently wrong the moment a
// chapter is edited, while the freshness gate reports the index current. This
// card is what keeps it authored: it proposes, the writer states, and an offer
// they walk past leaves nothing behind.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlaceStop } from "./PlaceStop";

afterEach(() => cleanup());

const CHAPTERS = [
  { anchor: "c-1", title: "Chapter One", filename: "01.md" },
  { anchor: "c-2", title: "Chapter Two", filename: "02.md" },
  { anchor: "c-3", title: "Chapter Three", filename: "03.md" },
  { anchor: "c-4", title: "Chapter Four", filename: "04.md" },
];

function open(props: Partial<React.ComponentProps<typeof PlaceStop>> = {}) {
  const onSave = vi.fn();
  const onSkip = vi.fn();
  render(
    <PlaceStop
      name="Serena"
      found={["c-1", "c-3"]}
      already={[]}
      chapters={CHAPTERS as never}
      onSave={onSave}
      onSkip={onSkip}
      {...props}
    />,
  );
  return { onSave, onSkip };
}

const ticked = () =>
  (within(screen.getByTestId("place-chapters"))
    .getAllByRole("checkbox") as HTMLInputElement[]);


describe("what the card offers", () => {
  it("shows the chapters the prose actually names, ticked", async () => {
    // Ticked because the scan FOUND the name there -- that is evidence, and
    // making the writer tick nine boxes to agree with their own book is the
    // tedium this feature exists to remove.
    open();
    const boxes = ticked();
    expect(boxes.length).toBe(2);
    expect(boxes.every(b => b.checked)).toBe(true);
    expect(screen.getByTestId("place-chapters").textContent)
      .toMatch(/Chapter One/);
    expect(screen.getByTestId("place-chapters").textContent)
      .toMatch(/Chapter Three/);
  });

  it("SAYS WHAT ANSWERING IS FOR, because the payoff happens elsewhere", () => {
    // Tagging chapters is work, and the reason to do it is invisible from this
    // card: it changes what the AI brief carries three screens away.
    open();
    const text = screen.getByTestId("place-stop").textContent ?? "";
    expect(text).toMatch(/only what belongs in the chapter you are writing/i);
  });

  it("promises nothing is saved until the button", () => {
    open();
    expect(screen.getByTestId("place-stop").textContent)
      .toMatch(/Nothing is saved until you press the button/i);
  });

  it("hides the chapters the prose does not name, but offers them", async () => {
    // A character can be in a scene the prose never names them in -- present,
    // never spoken to. The writer knows; the scan cannot.
    open();
    expect(ticked().length).toBe(2);
    await userEvent.click(screen.getByTestId("place-show-all"));
    expect(ticked().length).toBe(4);
  });

  it("marks what was already recorded apart from what was just found", () => {
    // Two different claims: one the writer made, one the app is making. A card
    // that showed them identically would ask them to re-confirm their own work.
    open({ found: ["c-3"], already: ["c-1"] });
    const text = screen.getByTestId("place-chapters").textContent ?? "";
    expect(text).toMatch(/already recorded/);
    expect(text).toMatch(/found here/);
  });
});


describe("what the card does", () => {
  it("records exactly what is ticked", async () => {
    const { onSave } = open();
    await userEvent.click(ticked()[0]);          // untick Chapter One
    await userEvent.click(screen.getByTestId("place-save"));
    expect(onSave).toHaveBeenCalledWith(["c-3"]);
  });

  it("counts what the button will do", async () => {
    open();
    expect(screen.getByTestId("place-save").textContent)
      .toMatch(/Record 2 chapters/);
    await userEvent.click(ticked()[0]);
    expect(screen.getByTestId("place-save").textContent)
      .toMatch(/Record 1 chapter/);
  });

  it("SAYS WHEN IT WOULD CLEAR AN EXISTING PLACEMENT", async () => {
    // Unticking everything is a real answer -- "I placed this wrongly" -- and
    // it has to be distinguishable from doing nothing, or a bad tag could
    // never be undone from inside the walk.
    open({ found: [], already: ["c-1", "c-2"] });
    for (const box of ticked()) await userEvent.click(box);
    expect(screen.getByTestId("place-stop").textContent)
      .toMatch(/will clear where Serena was recorded/i);
  });

  it("does not threaten to clear anything when there was nothing", async () => {
    // A warning that fires on a first-time answer is one the writer learns to
    // ignore before the time it matters.
    open({ found: ["c-1"], already: [] });
    await userEvent.click(ticked()[0]);
    expect(screen.getByTestId("place-stop").textContent)
      .not.toMatch(/will clear/i);
  });

  it("walking past it writes nothing", async () => {
    // The line that keeps presence authored: an offer the writer ignores
    // leaves no trace at all.
    const { onSave, onSkip } = open();
    await userEvent.click(screen.getByTestId("place-skip"));
    expect(onSkip).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps what the writer already recorded when they accept", async () => {
    // Accepting an offer must ADD to their statement rather than replace it,
    // or answering a stop about chapter six would silently drop chapter one.
    const { onSave } = open({ found: ["c-3"], already: ["c-1"] });
    await userEvent.click(screen.getByTestId("place-save"));
    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(["c-1", "c-3"]));
  });
});
