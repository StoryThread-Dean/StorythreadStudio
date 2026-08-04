// SpokenLine.test.tsx
// ====================
// The read-aloud flourish must never cost readability: every word is
// present as text, spaces survive, each word gets its own staggered
// delay, and the style rotates between visits.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { READING_STYLES, SpokenLine } from "./SpokenLine";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SpokenLine", () => {
  it("renders the sentence intact, spaces and all", () => {
    const { container } = render(
      <SpokenLine text="Hear your own words read aloud." style="stw-read-bold" />);
    // Word spans split the DOM, but the READING is unchanged: the
    // sentence's text content is exactly what was passed in, spaces
    // included, which is also what a screen reader announces.
    expect(container.textContent).toBe("Hear your own words read aloud.");
  });

  it("staggers a delay per spoken word (spaces are not words)", () => {
    const { container } = render(
      <SpokenLine text="one two three" style="stw-read-rise" pace={0.1} />);
    const words = container.querySelectorAll(".stw-read");
    expect(words.length).toBe(3);
    const delays = Array.from(words).map(w =>
      (w as HTMLElement).style.getPropertyValue("--stw-delay"));
    expect(delays).toEqual(["0s", "0.1s", "0.2s"]);
  });

  it("applies the requested style class", () => {
    const { container } = render(
      <SpokenLine text="hello" style="stw-read-sparkle" />);
    expect(container.querySelector(".stw-read-sparkle")).toBeTruthy();
  });

  it("picks a style at random when none is given", () => {
    // Rig the roll to the last style; the component must use it.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { container } = render(<SpokenLine text="hello" />);
    const last = READING_STYLES[READING_STYLES.length - 1];
    expect(container.querySelector(`.${last}`)).toBeTruthy();
  });
});
