// features/codex/FactLayer.test.tsx -- the fourth zoom level
// ===========================================================
// R8.9. The spec describes four layers, each a zoom of the one above:
// Constellation, Neighborhood, Thread card, Fact. The first three shipped and
// this one did not exist at all.
//
// What it must do is narrower than "show a fact", and the tests are about that
// narrowness. The Run editor already shows a fact's three switches; a second
// screen doing the same would give one idea two vocabularies, which is the
// failure this recovery keeps finding. So this layer answers what the switches
// DO -- where the fact is in force, what replaced it, and what a model would
// actually receive -- because that answer is spread across the resolver, the
// visibility rules and the brief, and no screen had ever gathered it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FactLayer } from "./FactLayer";
import type { ChapterAnchor, Fact } from "./api";

afterEach(() => cleanup());

const CHAPTERS: ChapterAnchor[] = [
  { chapter_id: "c-1", filename: "01.md", title: "The Raid",
    anchor: "c-1", act_id: "", act_title: "" },
  { chapter_id: "c-2", filename: "02.md", title: "North",
    anchor: "c-2", act_id: "", act_title: "" },
  { chapter_id: "c-3", filename: "03.md", title: "The Letter",
    anchor: "c-3", act_id: "", act_title: "" },
  { chapter_id: "c-4", filename: "04.md", title: "Home",
    anchor: "c-4", act_id: "", act_title: "" },
];

const PEOPLE = [{ entity_id: "e-elara", name: "Elara Voss" }];

function show(fact: Fact, run: Fact[] = [fact]) {
  const onClose = vi.fn();
  render(
    <FactLayer
      fact={fact}
      run={run}
      chapters={CHAPTERS}
      people={PEOPLE}
      entryName="Elara Voss"
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("where a fact is true", () => {
  it("draws the span and counts it, rather than leaving the writer to work it out", () => {
    // "From chapter 2 to the end of a 4 chapter book" is a sentence a writer
    // has to assemble. A bar is a shape they can see.
    show({ id: "f-1", at: "c-2", axis: "rank", value: "Made captain." });
    expect(screen.getByTestId("fact-span")).toBeTruthy();
    expect(screen.getByText(/3 of 4 chapters/)).toBeTruthy();
  });

  it("ends the span where something replaces it, and says what", () => {
    const first: Fact = { id: "f-1", at: "c-1", axis: "father",
                          value: "Died in the raid." };
    const second: Fact = { id: "f-2", at: "c-3", axis: "father",
                           value: "Alive, in hiding.", supersedes: "f-1" };
    show(first, [first, second]);
    expect(screen.getByText(/until 3\. The Letter/)).toBeTruthy();
    expect(screen.getByTestId("fact-chain").textContent)
      .toContain("Alive, in hiding.");
  });

  it("does not treat a later fact as an ending unless it says it replaces this", () => {
    // Two facts on one axis with nothing to order them is a Snag, and the
    // resolver refuses to settle it. Drawing an end here would take a side in
    // an argument the app deliberately will not.
    const first: Fact = { id: "f-1", at: "c-1", axis: "eyes", value: "Green." };
    const rival: Fact = { id: "f-2", at: "c-3", axis: "eyes", value: "Blue." };
    show(first, [first, rival]);
    expect(screen.getByText(/to the end of the book/)).toBeTruthy();
  });

  it("says an unplaced fact is true nowhere, and why that matters", () => {
    show({ id: "f-1", at: "", axis: "scar", value: "Carries a scar." });
    const said = screen.getByTestId("fact-unplaced").textContent ?? "";
    expect(said).toContain("never takes effect");
    expect(screen.queryByTestId("fact-span")).toBeNull();
  });
});

describe("the other two switches", () => {
  it("says a belief is only drawn on from that character's point of view", () => {
    // The thing a writer cannot learn from the form: a frame is not a label,
    // it changes when the fact is used at all.
    show({ id: "f-1", at: "c-1", axis: "father", value: "Died in the raid.",
           frame: "e-elara" });
    const said = screen.getByTestId("fact-frame").textContent ?? "";
    expect(said).toContain("Elara Voss believes this");
    expect(said).toContain("point of view");
  });

  it("says a held-back fact is hidden even where it is already true", () => {
    // The distinction the whole revealed_at switch exists for, and the one
    // most easily misread as a duplicate of "from when".
    show({ id: "f-1", at: "c-1", axis: "father", value: "Alive, in hiding.",
           revealed_at: "c-3" });
    const said = screen.getByTestId("fact-reveal").textContent ?? "";
    expect(said).toContain("Held back until 3. The Letter");
    expect(said).toContain("already true");
  });

  it("calls no reveal point the ordinary case rather than a gap", () => {
    show({ id: "f-1", at: "c-2", axis: "rank", value: "Made captain." });
    expect(screen.getByTestId("fact-reveal").textContent)
      .toContain("not a gap");
  });
});

describe("what the AI actually gets", () => {
  it("is the last thing said, because it is the only actionable one", () => {
    show({ id: "f-1", at: "c-1", axis: "father", value: "Alive, in hiding.",
           revealed_at: "c-3" });
    expect(screen.getByTestId("fact-brief").textContent)
      .toContain("3. The Letter");
  });

  it("says plainly that an unplaced fact reaches nothing", () => {
    show({ id: "f-1", at: "", axis: "scar", value: "Carries a scar." });
    expect(screen.getByTestId("fact-brief").textContent)
      .toContain("never reaches a brief");
  });
});

describe("what this layer does not do", () => {
  it("offers nothing to edit", () => {
    // A second place to change the three switches would give one idea two
    // vocabularies. The Run editor edits; this explains.
    show({ id: "f-1", at: "c-1", axis: "father", value: "Died in the raid." });
    const dialog = screen.getByTestId("fact-layer");
    expect(dialog.querySelectorAll("input, select, textarea").length).toBe(0);
  });

  it("closes back to the layer it came from", () => {
    const onClose = show({ id: "f-1", at: "c-1", axis: "x", value: "y" });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("uses no em dashes", () => {
    show({ id: "f-1", at: "c-1", axis: "father", value: "Died in the raid.",
           frame: "e-elara", revealed_at: "c-3", intentional: true });
    const text = screen.getByTestId("fact-layer").textContent ?? "";
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });
});
