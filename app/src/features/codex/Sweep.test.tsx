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
  it("is the ones whose answer is the same shape every time", () => {
    // Three now. `place` joined them because its answer is the same shape for
    // every row -- "yes, those chapters" -- and because a world of sixty
    // entries is sixty of them, which is exactly the count that made a
    // tick-list necessary for the other two.
    expect([...SWEEPABLE].sort())
      .toEqual(["loose_thread", "place", "unplaced"]);
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


// ── PLACING A WHOLE WORLD AT ONCE ───────────────────────────────────────────
//
// Declared presence needs one answer per entry, and a long book has sixty of
// them. Sixty screens is the thing the sweep exists to prevent -- the writer's
// own words about the first version of this problem were "forty unplaced facts
// should be a tick-list, not forty screens".
//
// The row's answer is the same shape every time ("yes, those chapters"), which
// is what makes it sweepable at all. Changing WHICH chapters is a real decision
// and stays one at a time.

describe("the place sweep", () => {
  const PLACE_STOPS = [
    { key: "place|e-serena", kind: "place", entity_id: "e-serena",
      title: "Where does Serena appear?", why: "",
      detail: { name: "Serena", type: "character",
                found: ["c-1", "c-2"], already: [] } },
    { key: "place|e-lou", kind: "place", entity_id: "e-lou",
      title: "Where does Lou appear?", why: "",
      detail: { name: "Lou", type: "character",
                found: ["c-2"], already: ["c-1"] } },
  ] as never as Parameters<typeof Sweep>[0]["stops"];

  function openPlace() {
    const onRecordPlace = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(
      <Sweep stops={PLACE_STOPS} kind="place" chapters={CHAPTERS}
             onPlace={vi.fn()} onRecordPlace={onRecordPlace}
             onDismiss={onDismiss} onDone={onDone} onClose={vi.fn()} />,
    );
    return { onRecordPlace, onDismiss, onDone };
  }

  it("SHOWS WHICH CHAPTERS EACH ROW WOULD RECORD", () => {
    // The whole decision is "does that look right", and it cannot be made
    // without seeing the answer being offered.
    openPlace();
    const shown = screen.getAllByTestId("sweep-place-chapters");
    // Resolved to the chapter's TITLE, not its id -- an anchor is a machine
    // word and the writer is being asked to recognise their own book.
    expect(shown[0].textContent).toMatch(/The Raid/);
    expect(shown[0].textContent).toMatch(/North/);
  });

  it("ticks nothing on open", async () => {
    // The sweep's own rule, and here it is the write boundary: nothing about
    // the writer's world changes because a screen appeared.
    openPlace();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.every(b => !b.checked)).toBe(true);
  });

  it("records the ticked rows, and only those", async () => {
    const { onRecordPlace } = openPlace();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByTestId("sweep-record-place"));
    await waitFor(() => expect(onRecordPlace).toHaveBeenCalledTimes(1));
    expect(onRecordPlace.mock.calls[0][1]).toEqual(["c-1", "c-2"]);
  });

  it("KEEPS WHAT THE WRITER ALREADY RECORDED", async () => {
    // Accepting an offer must ADD to their statement rather than replace it.
    // Lou is already placed in chapter one and the scan found chapter two;
    // recording must not drop chapter one.
    const { onRecordPlace } = openPlace();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByTestId("sweep-record-place"));
    await waitFor(() => expect(onRecordPlace).toHaveBeenCalled());
    expect(onRecordPlace.mock.calls[0][1]).toEqual(["c-1", "c-2"]);
  });

  it("counts what the button will do", async () => {
    openPlace();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]);
    expect(screen.getByTestId("sweep-record-place").textContent)
      .toMatch(/Record 1/);
    fireEvent.click(boxes[1]);
    expect(screen.getByTestId("sweep-record-place").textContent)
      .toMatch(/Record 2/);
  });

  it("offers the permanent no in this kind's own words", () => {
    openPlace();
    expect(screen.getByTestId("sweep-dismiss").textContent)
      .toMatch(/Do not place/);
  });

  it("says to open one alone to change its chapters", () => {
    // The sweep accepts a suggestion wholesale. Editing which chapters is a
    // real decision and belongs where each chapter is individually tickable.
    openPlace();
    expect(screen.getByTestId("sweep").textContent)
      .toMatch(/open that one on its own/i);
  });
});

// ── DEALING WITH ONE PROPERLY, FROM THE LIST ────────────────────────────────
//
// Reported from live testing, about the Loose thread sweep: the writer read the
// screen as having no purpose, because the only two answers were "these need no
// connection" and "go one at a time instead" -- while the button that opened it
// said "Work through all 7 at once" and the text told them to "deal with one
// properly".
//
// The batch answer for a Loose thread really is the NO, and that is not a bug:
// a Tie carries a REQUIRED reason line, so seven connections can never be seven
// ticks. What was missing is the other half the words already promised.
describe("dealing with one properly", () => {
  const STOPS = [loose(1, "Chelsea"), loose(2, "Steel Beam")];

  function showLoose(onDealWith?: (stop: Stop) => void) {
    render(
      <Sweep stops={STOPS} kind="loose_thread" chapters={CHAPTERS}
             onPlace={vi.fn()} onDismiss={vi.fn().mockResolvedValue(undefined)}
             onDone={vi.fn()} onClose={vi.fn()} onDealWith={onDealWith} />,
    );
  }

  it("offers it on every row, and hands back that exact stop", () => {
    const onDealWith = vi.fn();
    showLoose(onDealWith);
    const buttons = screen.getAllByTestId("sweep-deal-with");
    expect(buttons.length).toBe(STOPS.length);
    fireEvent.click(buttons[1]);
    expect(onDealWith).toHaveBeenCalledTimes(1);
    // The STOP, not an index -- the caller finds its own position from the key,
    // so a list ordered or filtered differently cannot send the walk to the
    // wrong screen.
    expect(onDealWith.mock.calls[0][0].key).toBe(STOPS[1].key);
  });

  it("says what it is for in this kind's own words", () => {
    // "Connect" on a Loose thread, because that is the thing the batch cannot
    // do. A generic "Open" would leave the writer where they started: unsure
    // whether this screen can make a connection at all.
    showLoose(vi.fn());
    expect(screen.getAllByTestId("sweep-deal-with")[0].textContent)
      .toMatch(/connect/i);
  });

  it("names the reason a connection is one at a time", () => {
    // Not "deal with one properly" with no explanation. The writer asked what
    // this screen was FOR; the answer is that ticking is the batch no, and a
    // connection carries a reason of its own, so it cannot be a tick.
    showLoose(vi.fn());
    expect(screen.getByTestId("sweep").textContent)
      .toMatch(/reason of its own/i);
  });

  it("is absent when the caller offers no way to take one on", () => {
    // The prop is optional, so a caller that cannot land the walk on a stop
    // must not render a button that does nothing -- which is the whole class of
    // bug this change is fixing.
    showLoose();
    expect(screen.queryByTestId("sweep-deal-with")).toBeNull();
  });
});
