// features/codex/Sweep.test.tsx -- forty of a thing as a list
// ===========================================================
// Ruling 8, in the writer's own words: "Forty unplaced facts should be a
// tick-list, not forty screens." The spec had asked for exactly that from the
// start ("a multi-select list, not a forced march") and it shipped as a
// one-at-a-time walk; the ruling was approved and never became a task id, so
// nothing was comparing the build against it.
//
// What these tests are really about is restraint. A batch screen over the
// writer's own files is easy to make dangerous: pre-ticked rows, a count that
// does not match what it writes, a partial failure that resets, or no way back
// to the careful path. Each of those is pinned below.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { Sweep, SWEEPABLE } from "./Sweep";
import type { ChapterAnchor } from "./api";
import type { Stop } from "./weavingApi";

afterEach(() => cleanup());

const CHAPTERS: ChapterAnchor[] = [
  { chapter_id: "c-1", filename: "01.md", title: "The Raid",
    anchor: "c-1", act_id: "", act_title: "" },
  { chapter_id: "c-2", filename: "02.md", title: "North",
    anchor: "c-2", act_id: "", act_title: "" },
];

function unplaced(n: number, value: string): Stop {
  return {
    kind: "unplaced", key: `unplaced|e-${n}`, entity_id: `e-${n}`,
    title: `A fact never takes effect`, why: "Nothing says when.",
    chapter_id: "", quote: "", evidence_hash: "",
    detail: { name: `Person ${n}`, type: "character",
              sides: [{ id: `f-${n}`, value }] },
  };
}

function loose(n: number, name: string): Stop {
  return {
    kind: "loose_thread", key: `loose|e-${n}`, entity_id: `e-${n}`,
    title: `How is ${name} connected to the story?`, why: "Nothing records it.",
    chapter_id: "", quote: "", evidence_hash: "",
    detail: { name, type: "character" },
  };
}

function showUnplaced(stops = [unplaced(1, "Carries a scar."),
                               unplaced(2, "Owns the shop."),
                               unplaced(3, "Speaks three languages.")]) {
  const onPlace = vi.fn().mockResolvedValue(undefined);
  const onDismiss = vi.fn().mockResolvedValue(undefined);
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <Sweep stops={stops} kind="unplaced" chapters={CHAPTERS}
           onPlace={onPlace} onDismiss={onDismiss}
           onDone={onDone} onClose={onClose} />,
  );
  return { onPlace, onDismiss, onDone, onClose };
}

describe("which kinds get a list at all", () => {
  it("is the two whose answer is the same shape every time", () => {
    expect([...SWEEPABLE].sort()).toEqual(["loose_thread", "unplaced"]);
  });

  it("never a Snag", () => {
    // Every Snag is a different argument. A tick-list would invite settling
    // them without reading them, which is the one thing a contradiction
    // checker must not make easy.
    expect(SWEEPABLE.has("snag")).toBe(false);
    expect(SWEEPABLE.has("tangle")).toBe(false);
    // And not Frayed: filling in prose is writing, not triage.
    expect(SWEEPABLE.has("frayed")).toBe(false);
  });
});

describe("the unplaced list", () => {
  it("shows every one of them, with the fact's own words and its entry", () => {
    showUnplaced();
    const list = screen.getByTestId("sweep");
    expect(within(list).getByText(/Carries a scar\./)).toBeTruthy();
    expect(within(list).getByText(/Owns the shop\./)).toBeTruthy();
    // A list of forty fact texts with no owner is forty sentences about nobody.
    expect(list.textContent).toContain("Person 1");
  });

  it("arrives with nothing ticked", () => {
    // This writes to the writer's own files. Forty pre-ticked boxes beside a
    // Place button is a bulk write they did not choose.
    showUnplaced();
    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.getByTestId("sweep-place").textContent).toContain("Place 0");
  });

  it("cannot place anything until something is chosen", () => {
    showUnplaced();
    expect(screen.getByTestId("sweep-place")
      .hasAttribute("disabled")).toBe(true);
  });

  it("treats choosing a chapter as the intent to place it", () => {
    // Asking for the chapter and then asking again with a checkbox is two
    // clicks for one decision.
    showUnplaced();
    fireEvent.change(screen.getByLabelText("Chapter for Carries a scar."),
                     { target: { value: "c-2" } });
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked)
      .toBe(true);
    expect(screen.getByTestId("sweep-place").textContent).toContain("Place 1");
  });

  it("places only the ticked rows, each at its own chapter", async () => {
    const { onPlace } = showUnplaced();
    fireEvent.change(screen.getByLabelText("Chapter for Carries a scar."),
                     { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText("Chapter for Owns the shop."),
                     { target: { value: "c-2" } });
    fireEvent.click(screen.getByTestId("sweep-place"));
    await waitFor(() => expect(onPlace).toHaveBeenCalledTimes(2));
    expect(onPlace.mock.calls[0][1]).toBe("c-1");
    expect(onPlace.mock.calls[1][1]).toBe("c-2");
    // The third was never touched, so it must come back next time.
    expect(onPlace.mock.calls.map(c => c[0].key))
      .toEqual(["unplaced|e-1", "unplaced|e-2"]);
  });

  it("says out loud when a ticked row has no chapter yet", async () => {
    // "Place 12" that places 9 is the quiet arithmetic that makes a writer stop
    // believing a count.
    showUnplaced();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByTestId("sweep-no-chapter").textContent)
      .toContain("1 ticked");
    expect(screen.getByTestId("sweep-place").textContent).toContain("Place 0");
  });

  it("reports what is left after a partial pass rather than closing", async () => {
    const { onPlace, onDone } = showUnplaced();
    fireEvent.change(screen.getByLabelText("Chapter for Carries a scar."),
                     { target: { value: "c-1" } });
    fireEvent.click(screen.getByTestId("sweep-place"));
    await waitFor(() => expect(onPlace).toHaveBeenCalled());
    expect(screen.getByTestId("sweep-done").textContent).toContain("1 settled");
    // Two left, so the writer stays here rather than being thrown back.
    expect(onDone).not.toHaveBeenCalled();
  });

  it("finishes the moment the last row is settled", async () => {
    const { onDone } = showUnplaced([unplaced(1, "Only one.")]);
    fireEvent.change(screen.getByLabelText("Chapter for Only one."),
                     { target: { value: "c-1" } });
    fireEvent.click(screen.getByTestId("sweep-place"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(["unplaced|e-1"]));
  });

  it("keeps the writes that landed when one fails part way", async () => {
    // Half of forty writes landing and the screen resetting would make the
    // writer redo work already on disk.
    const onPlace = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Disk is full."));
    render(
      <Sweep stops={[unplaced(1, "First."), unplaced(2, "Second.")]}
             kind="unplaced" chapters={CHAPTERS}
             onPlace={onPlace} onDismiss={vi.fn()}
             onDone={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Chapter for First."),
                     { target: { value: "c-1" } });
    fireEvent.change(screen.getByLabelText("Chapter for Second."),
                     { target: { value: "c-1" } });
    fireEvent.click(screen.getByTestId("sweep-place"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const said = screen.getByRole("alert").textContent ?? "";
    expect(said).toContain("Disk is full.");
    // And it says how far it got, which is the number the writer needs.
    expect(said).toContain("1 of 2");
    expect(screen.getByTestId("sweep-done").textContent).toContain("1 settled");
  });

  it("can leave a fact unplaced for good, in a batch", async () => {
    const { onDismiss } = showUnplaced();
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    fireEvent.click(screen.getByTestId("sweep-dismiss"));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onDismiss.mock.calls[0][0].key).toBe("unplaced|e-3");
  });
});

describe("the loose thread list", () => {
  function showLoose() {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(
      <Sweep stops={[loose(1, "Rosie"), loose(2, "Steel Beam")]}
             kind="loose_thread" chapters={CHAPTERS}
             onPlace={vi.fn()} onDismiss={onDismiss}
             onDone={onDone} onClose={vi.fn()} />,
    );
    return { onDismiss, onDone };
  }

  it("offers the batch NO, which is the answer it exists for", () => {
    // Thirty entries that do not need a connection is one sentence. Thirty
    // screens asking a question the writer already answered in their head is
    // how a walkthrough teaches them to click through it.
    showLoose();
    expect(screen.getByTestId("sweep-dismiss").textContent)
      .toContain("need no connection");
  });

  it("offers no chapter picker, because a connection is not a date", () => {
    showLoose();
    expect(screen.queryByLabelText(/^Chapter for/)).toBeNull();
    expect(screen.queryByTestId("sweep-place")).toBeNull();
  });

  it("settles the ticked ones and leaves the rest", async () => {
    const { onDismiss } = showLoose();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByTestId("sweep-dismiss"));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onDismiss.mock.calls[0][0].detail.name).toBe("Rosie");
  });
});

describe("not a forced march, in either direction", () => {
  it("always offers the way back to one at a time", () => {
    // A list the writer cannot leave is a longer march than the walk. And the
    // careful path is the RIGHT one for a loose thread that does need a
    // connection: that needs the other end and a reason.
    const { onClose } = showUnplaced();
    fireEvent.click(screen.getByTestId("sweep-one-at-a-time"));
    expect(onClose).toHaveBeenCalled();
  });

  it("changes nothing on the way out", () => {
    const { onPlace, onDismiss, onDone } = showUnplaced();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByTestId("sweep-one-at-a-time"));
    expect(onPlace).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("uses no em dashes", () => {
    showUnplaced();
    const text = screen.getByTestId("sweep").textContent ?? "";
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });
});
