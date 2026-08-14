// features/codex/Scrubber.test.tsx
// ================================
// From review, on the first version:
//
//     "The slider is currently just a bar with a dot. There is no direct
//      link/connection that sliding it does anything... Writer needs to see an
//      immediate and direct corolation that the slider moves as Chapter in a
//      timeline from Chapter 1 to Chapter N being the end."
//
// And the fix, sketched in the same message: act bands above, a stop per
// chapter, and the resting chapter's title EXPANDED and word-wrapped while its
// neighbours truncate. That expansion is the cause and effect -- the writer
// sees the handle land on a chapter rather than inferring it from a colour
// change somewhere else on the screen.

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BEFORE_THE_BOOK, Scrubber } from "./Scrubber";
import type { ChapterAnchor } from "./api";

afterEach(cleanup);

function chapter(n: number, title: string, act = ""): ChapterAnchor {
  return {
    chapter_id: `c-${n}`,
    filename: `${String(n).padStart(2, "0")}.md`,
    title,
    anchor: `c-${n}`,
    act_id: act ? `a-${act}` : "",
    act_title: act,
  };
}

/** The example from the review message, near enough. */
const BOOK = [
  chapter(1, "Chance Meeting in the Stacks", "Act I"),
  chapter(2, "Through the Crack", "Act I"),
  chapter(3, "Caught in the Rain", "Act I"),
  chapter(4, "The Long Way Round", "Act II"),
  chapter(5, "A Door That Was Not There", "Act II"),
  chapter(6, "What the River Kept", "Act III"),
];

function open(value = BEFORE_THE_BOOK, chapters = BOOK) {
  const onChange = vi.fn();
  render(<Scrubber chapters={chapters} value={value} onChange={onChange} />);
  return { onChange };
}

/**
 * The fraction of the track a placed element sits at.
 *
 * Positions are written as `calc(8px + <fraction> * (100% - 16px))` -- the same
 * expression the browser uses for the thumb -- so a test can read the fraction
 * back out and check the arithmetic without a layout engine.
 */
function fractionOf(left: string): number {
  const match = /calc\(8px \+ ([\d.]+) \* \(100% - 16px\)\)/.exec(left);
  if (!match) throw new Error(`not a placed position: ${left}`);
  return Number(match[1]);
}

const ticks = () => screen.getAllByTestId("scrubber-tick");
const titles = () => screen.getAllByTestId("scrubber-title");
const active = (nodes: HTMLElement[]) =>
  nodes.filter(n => n.getAttribute("data-active") === "true");


describe("it draws the thing it moves through", () => {
  it("puts a stop on every chapter", async () => {
    // The reported problem was a bar with nothing on it, so there was nothing
    // to connect the handle to.
    open();
    expect(ticks()).toHaveLength(BOOK.length);
  });

  it("names every chapter, numbered", async () => {
    open();
    const text = titles().map(t => t.textContent ?? "").join(" | ");
    expect(text).toMatch(/1\s+Chance Meeting/);
    expect(text).toMatch(/6\s+What the River Kept/);
  });

  it("bands the acts over the chapters they contain", async () => {
    open();
    for (const act of ["Act I", "Act II", "Act III"]) {
      expect(screen.getByTitle(act)).toBeTruthy();
    }
  });

  it("sizes an act band by how much book it is", async () => {
    // Act I is three chapters of six. A band of equal width would say the
    // book is evenly divided when it is not. Read off the placement grid
    // rather than off flex, because bands are now on the same grid as the
    // ticks and the handle.
    open();
    // Contiguous: each band starts where the previous one ended, and ends on
    // its own last chapter's stop.
    expect(fractionOf(screen.getByTitle("Act I").style.left)).toBe(0);
    expect(fractionOf(screen.getByTitle("Act II").style.left))
      .toBeCloseTo(3 / 6, 5);
    expect(fractionOf(screen.getByTitle("Act III").style.left))
      .toBeCloseTo(5 / 6, 5);
  });

  it("draws no act row at all when the writer has not used acts", async () => {
    // An empty band across the whole book would be furniture that says
    // nothing.
    open(BEFORE_THE_BOOK, [chapter(1, "One"), chapter(2, "Two")]);
    expect(screen.queryByTitle("Not in an act")).toBeNull();
  });

  it("says so for chapters outside an act when others are in one", async () => {
    open(BEFORE_THE_BOOK, [
      chapter(1, "One", "Act I"),
      chapter(2, "Loose idea"),
    ]);
    expect(screen.getByTitle("Not in an act")).toBeTruthy();
  });
});


describe("the expansion is the cause and effect", () => {
  it("opens out the chapter the handle is resting on", async () => {
    open(0);
    expect(active(titles())).toHaveLength(1);
    expect(active(titles())[0].textContent).toMatch(/Chance Meeting in the Stacks/);
  });

  it("gives it the room to wrap, rather than truncating it", async () => {
    // The whole title, over as many lines as it needs. Truncating the ONE
    // chapter the writer is looking at would defeat the point.
    open(0);
    const [resting] = active(titles());
    expect(resting.style.flexGrow).toBe("3");
    expect(resting.className).not.toMatch(/truncate/);
  });

  it("keeps the neighbours narrow and truncated", async () => {
    open(0);
    const others = titles().filter(t => t.getAttribute("data-active") !== "true");
    for (const other of others) {
      expect(other.style.flexGrow).toBe("1");
      expect(other.className).toMatch(/truncate/);
    }
  });

  it("moves the expansion when the handle moves", async () => {
    // The sketch in review: chapter 1 open, then chapter 2 open and 1 closed.
    const { onChange } = open(0);
    fireEvent.change(screen.getByLabelText("Point in the story"),
                     { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith(1);

    cleanup();
    open(1);
    expect(active(titles())[0].textContent).toMatch(/Through the Crack/);
    expect(active(titles())[0].textContent).not.toMatch(/Chance Meeting/);
  });

  it("marks the resting stop on the track too", async () => {
    open(2);
    expect(active(ticks())).toHaveLength(1);
    expect(ticks()[2].getAttribute("data-active")).toBe("true");
  });

  it("expands nothing before the book begins", async () => {
    // There is no chapter to open out, and pretending chapter one is active
    // would misreport where the handle is.
    open(BEFORE_THE_BOOK);
    expect(active(titles())).toHaveLength(0);
  });

  it("says in words that before the book is a real place to stand", async () => {
    // It is the world as the reader meets it, and the track has nowhere to
    // show that.
    open(BEFORE_THE_BOOK);
    expect(screen.getByText(/nothing has happened yet/i)).toBeTruthy();
  });

  it("stops saying it once the handle moves into the book", async () => {
    open(0);
    expect(screen.queryByText(/nothing has happened yet/i)).toBeNull();
  });
});


describe("it stays a real control", () => {
  // The drawn track is decoration over a genuine range input. A custom widget
  // would have to reimplement arrow keys, Home and End, and the screen-reader
  // role -- and the List view being the accessibility answer for the map would
  // be undercut by a scrubber that could only be dragged.

  it("is a slider a keyboard can drive", async () => {
    open(0);
    const slider = screen.getByLabelText("Point in the story");
    expect(slider.getAttribute("type")).toBe("range");
    expect(slider.getAttribute("min")).toBe("-1");
    expect(slider.getAttribute("max")).toBe(String(BOOK.length - 1));
  });

  it("steps one chapter at a time, so every stop is reachable", async () => {
    open(0);
    expect(screen.getByLabelText("Point in the story").getAttribute("step"))
      .toBe("1");
  });

  it("announces where it is, by chapter and title", async () => {
    // "3" on its own tells a screen-reader user nothing about the book.
    open(2);
    expect(screen.getByLabelText("Point in the story")
      .getAttribute("aria-valuetext"))
      .toBe("Chapter 3, Caught in the Rain");
  });

  it("announces the position before the book as words too", async () => {
    open(BEFORE_THE_BOOK);
    expect(screen.getByLabelText("Point in the story")
      .getAttribute("aria-valuetext")).toBe("Before the book begins");
  });

  it("reports the chapter index, not a chapter id", async () => {
    const { onChange } = open(0);
    fireEvent.change(screen.getByLabelText("Point in the story"),
                     { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith(4);
  });
});


describe("a book with nothing in it", () => {
  it("says why there is nothing to move through", async () => {
    open(BEFORE_THE_BOOK, []);
    expect(screen.getByText(/no chapters yet/)).toBeTruthy();
    expect(screen.queryByLabelText("Point in the story")).toBeNull();
  });
});

describe("the handle and the ticks share one grid", () => {
  // Reported after the first version shipped:
  //
  //     "the issue is the slider isn't lining up with the dots behind it...
  //      the (O) indicates where the slider's dot ends up while the -o- part is
  //      the background positions of each of the chapters"
  //
  // A range input's thumb CENTRE travels from half a thumb in to half a thumb
  // short of the far end, and there are chapters.length + 1 stops rather than
  // chapters.length. The first version spread ticks edge to edge across N
  // positions with `justify-between`, which is one stop out and drifts.
  //
  // These read the placement expression back out, so the arithmetic is pinned
  // without needing a layout engine.

  it("insets every tick by half a thumb, as the browser does", async () => {
    open();
    for (const tick of ticks()) {
      expect(tick.style.left).toMatch(/^calc\(8px \+ /);
      expect(tick.style.left).toMatch(/\(100% - 16px\)\)$/);
    }
  });

  it("divides the track by the number of STOPS, not of chapters", async () => {
    // The off-by-one itself. Six chapters means seven stops, so chapter one
    // sits at 1/6 of the travel and not at 0.
    open();
    const positions = ticks().map(t => fractionOf(t.style.left));
    expect(positions).toEqual([1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 6 / 6]);
  });

  it("puts before-the-book at the very start of the travel", async () => {
    open();
    expect(fractionOf(screen.getByTestId("scrubber-start").style.left)).toBe(0);
  });

  it("puts the last chapter at the very end of the travel", async () => {
    // Where the thumb sits at its maximum. If these disagree the drift is
    // visible at one end however well the middle lines up.
    open();
    const positions = ticks().map(t => fractionOf(t.style.left));
    expect(positions[positions.length - 1]).toBe(1);
  });

  it("spaces the stops evenly, whatever the book's length", async () => {
    cleanup();
    open(BEFORE_THE_BOOK, [chapter(1, "One"), chapter(2, "Two"),
                           chapter(3, "Three")]);
    const positions = ticks().map(t => fractionOf(t.style.left));
    const gaps = positions.slice(1).map((p, i) => p - positions[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(1 / 3, 5);
  });

  it("marks before-the-book as a stop, and does not count it as a chapter", async () => {
    // It is a real position the handle rests on, and it is not a chapter --
    // conflating the two is what made the count wrong in the first place.
    open();
    expect(screen.getByTestId("scrubber-start")).toBeTruthy();
    expect(ticks()).toHaveLength(BOOK.length);
  });

  it("ends an act band on its last chapter's own stop", async () => {
    // So the boundary the writer sees is where the handle actually stops,
    // which is what made the acts look right even when the ticks did not.
    open();
    const actOne = screen.getByTitle("Act I");
    expect(actOne.style.width)
      .toBe(`calc(${ticks()[2].style.left} - ${actOne.style.left})`);
  });

  it("leaves no gap between one act and the next", async () => {
    // A half-step gap crept in while fixing the ticks. Bands describe a
    // continuous book, and a book has no holes in it. Act I's width is
    // "where it ends minus where it starts", so the place it ends has to be
    // exactly where Act II begins.
    open();
    const one = screen.getByTitle("Act I");
    const two = screen.getByTitle("Act II");
    expect(one.style.width).toBe(`calc(${two.style.left} - ${one.style.left})`);
  });
});
