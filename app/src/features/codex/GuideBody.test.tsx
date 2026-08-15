// features/codex/GuideBody.test.tsx
// ==================================
// An explanation nobody reads is worse than none, because it cost the
// writer the click. This renders the guides so they can be SCANNED: each
// kind on its own line with its term pulled to the front, so "what can I
// put here?" is answered without reading a paragraph.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuideBody } from "./GuideBody";
import { GROUP_GUIDES, type GuideLine } from "./lexicon";

afterEach(cleanup);

const LINES: GuideLine[] = [
  { term: "The Weave", text: "is everything in your world." },
  { term: "PROFILES", text: "is the part about the things *in* it." },
  { term: "Factions", text: "for groups with their own interests.", indent: true },
  { term: "Religions", text: "for what people believe.", indent: true },
  { text: "You do not need all of them." },
];


describe("laying it out", () => {
  it("gives every line its own block, not one paragraph", () => {
    const { container } = render(<GuideBody lines={LINES} />);
    expect(container.querySelectorAll("p")).toHaveLength(LINES.length);
  });

  it("puts the term at the front of its line", () => {
    render(<GuideBody lines={LINES} />);
    const line = screen.getByText("Factions").closest("p")!;
    expect(line.textContent).toBe("Factions for groups with their own interests.");
  });

  it("indents the kinds so the list reads as a list", () => {
    render(<GuideBody lines={LINES} />);
    expect(screen.getByText("Factions").closest("p")!.className).toContain("pl-3");
    expect(screen.getByText("The Weave").closest("p")!.className).not.toContain("pl-3");
  });
});


describe("emphasis", () => {
  it("marks the leading term so the eye can run down them", () => {
    render(<GuideBody lines={LINES} />);
    const term = screen.getByText("Factions");
    expect(term.className).toContain("font-semibold");
    expect(term.className).toContain("violet");
  });

  it("marks a phrase inside a sentence", () => {
    render(<GuideBody lines={[{ text: "the things *in* it" }]} />);
    expect(screen.getByText("in").className).toContain("violet");
  });

  it("never shows the asterisks themselves", () => {
    const { container } = render(<GuideBody lines={LINES} />);
    expect(container.textContent).not.toContain("*");
  });

  it("leaves a line with no emphasis alone", () => {
    render(<GuideBody lines={[{ text: "Plain sentence." }]} />);
    expect(screen.getByText("Plain sentence.")).toBeTruthy();
  });

  it("handles several emphasised phrases in one line", () => {
    render(<GuideBody lines={[{ text: "a *Bloodline*, a *Guild*, a *Starship class*" }]} />);
    for (const phrase of ["Bloodline", "Guild", "Starship class"]) {
      expect(screen.getByText(phrase).className).toContain("violet");
    }
  });
});


describe("the real guides", () => {
  it("renders each group without showing markup", () => {
    for (const group of ["notes", "profiles", "other"]) {
      cleanup();
      const { container } = render(<GuideBody lines={GROUP_GUIDES[group]} />);
      expect(container.textContent, group).not.toContain("*");
      expect(container.querySelectorAll("p").length, group)
        .toBe(GROUP_GUIDES[group].length);
    }
  });

  it("lists the Profiles kinds down the page", () => {
    const { container } = render(<GuideBody lines={GROUP_GUIDES.profiles} />);
    const terms = Array.from(container.querySelectorAll("p.pl-3"))
      .map(p => p.querySelector("span")?.textContent?.trim());
    expect(terms).toEqual([
      "Factions", "Religions", "Ruling Authorities", "Deities", "Creatures",
      "Cultures", "Relationships",
    ]);
  });
});
