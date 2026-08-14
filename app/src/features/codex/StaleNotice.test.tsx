// features/codex/StaleNotice.test.tsx -- the walk admitting its evidence moved
// =============================================================================
// R8.1. These are contracts about HONESTY, which is why they are worth pinning:
// the failure this replaces was not a crash but a silence. The backend marked
// findings stale, returned the count, and no component read it, so a question
// the writer had put off about a sentence they later rewrote came back quoting
// the new sentence as though it had always said that.
//
// The two things a silence test has to check are that it speaks when it should
// and stays quiet when it should. Both are here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StaleMark, StaleNotice } from "./StaleNotice";

afterEach(() => cleanup());

describe("the stale banner", () => {
  it("says nothing when nothing changed", () => {
    // A banner that appears on every resume saying "0 stale" is noise, and
    // noise is what teaches a writer to stop reading banners.
    const { container } = render(
      <StaleNotice report={{ stale: 0, chapters: [] }}
                   onRecheck={() => {}} scoped={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("says nothing when there is no report at all", () => {
    // The setup screen scans with no run id, so there is no report to show.
    const { container } = render(
      <StaleNotice report={undefined} onRecheck={() => {}} scoped={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("says how many and that the wording is the new wording", () => {
    // The second half is the load-bearing part. "3 questions are stale" tells
    // the writer a state; "they are being asked again about the new wording"
    // tells them what they are reading.
    render(
      <StaleNotice report={{ stale: 3, chapters: ["Chapter 4"] }}
                   onRecheck={() => {}} scoped={false} />,
    );
    const text = screen.getByTestId("stale-notice").textContent ?? "";
    expect(text).toContain("3 questions");
    expect(text).toContain("changed since");
    expect(text).toContain("new wording");
  });

  it("names the chapters rather than counting them", () => {
    // "2 chapters" is not something a writer can recognise. "Chapter 4" is.
    render(
      <StaleNotice report={{ stale: 2, chapters: ["Chapter 4", "Chapter 11"] }}
                   onRecheck={() => {}} scoped={false} />,
    );
    const where = screen.getByTestId("stale-where").textContent ?? "";
    expect(where).toContain("Chapter 4");
    expect(where).toContain("Chapter 11");
  });

  it("admits what a chapter-scoped re-check would leave out", () => {
    // Some stale stops belong to no chapter, so narrowing cannot include them
    // and the two numbers would not agree. Saying so is the difference between
    // a bound and a lie.
    render(
      <StaleNotice report={{ stale: 3, chapters: ["Chapter 4"],
                             stale_elsewhere: 2 }}
                   onRecheck={() => {}} scoped={false} />,
    );
    const where = screen.getByTestId("stale-where").textContent ?? "";
    expect(where).toContain("2 more");
    expect(where).toContain("leaves");
  });

  it("offers the scoped re-check with the chapters it would use", () => {
    const onRecheck = vi.fn();
    render(
      <StaleNotice report={{ stale: 2, chapters: ["Chapter 4", "Chapter 11"] }}
                   onRecheck={onRecheck} scoped={false} />,
    );
    fireEvent.click(screen.getByTestId("stale-recheck"));
    expect(onRecheck).toHaveBeenCalledWith(["Chapter 4", "Chapter 11"]);
  });

  it("offers no re-check when there is no chapter to narrow to", () => {
    // Every stale stop is entity-shaped. A button that narrowed to nothing
    // would empty the walk and look like a bug.
    render(
      <StaleNotice report={{ stale: 1, chapters: [], stale_elsewhere: 1 }}
                   onRecheck={() => {}} scoped={false} />,
    );
    expect(screen.queryByTestId("stale-recheck")).toBeNull();
  });

  it("offers the way back once narrowed, even with nothing stale left", () => {
    // A narrowing with no exit is a trap, and after the writer answers the
    // stale ones the count goes to zero -- which is exactly when they need the
    // way out most.
    const onRecheck = vi.fn();
    render(
      <StaleNotice report={{ stale: 0, chapters: [] }}
                   onRecheck={onRecheck} scoped={true} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /all of it again/i }));
    expect(onRecheck).toHaveBeenCalledWith(null);
  });

  it("uses no em dashes", () => {
    render(
      <StaleNotice report={{ stale: 2, chapters: ["Chapter 4"],
                             stale_elsewhere: 1 }}
                   onRecheck={() => {}} scoped={false} />,
    );
    const text = screen.getByTestId("stale-notice").textContent ?? "";
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });
});

describe("the mark on one card", () => {
  it("says the quote above is the new wording", () => {
    // The card is where the writer decides. The banner has already explained
    // the situation; this only has to answer "is this one of them?".
    render(<StaleMark />);
    const text = screen.getByTestId("stale-mark").textContent ?? "";
    expect(text).toContain("put this one off before");
    expect(text).toContain("rewritten");
    expect(text).toContain("new wording");
  });
});
