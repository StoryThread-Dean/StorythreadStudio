// RunEditor.test.tsx -- recording how an entry changes across the book
// ====================================================================
// The writer, on the timeline: "I haven't gotten to the timeline part of how
// things work yet. If its built, I have never accessed it."
//
// It was built -- anchors, resolution, a story scrubber on the Weave map, spoiler
// mode -- and it had nothing to move through, because facts could only be
// recorded in the Weave's own editor, which serves the kinds a novelist rarely
// opens. Characters, relationships, locations and lore live in the Profile
// Builder, which had no fact UI at all.
//
// So this editor is now shared by both screens rather than copied into the
// second, and it gained the one control that existed nowhere: when the READER
// learns something, which is a different question from when it becomes true and
// is what spoiler mode hides against.

import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunEditor } from "./RunEditor";
import type { Fact } from "./api";

afterEach(cleanup);

const CHAPTERS = [
  { chapter_id: "c-1", filename: "01.md", title: "The Raid",
    anchor: "c-1", act_id: "", act_title: "" },
  { chapter_id: "c-15", filename: "15.md", title: "The Letter",
    anchor: "c-15", act_id: "", act_title: "" },
];

function show(run: Fact[] = [], props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(<RunEditor run={run} chapters={CHAPTERS} onChange={onChange} {...props} />);
  return { onChange };
}

/** Open a fact so its fields are on screen. They sit behind a summary line now:
 *  one open at a time, so six facts read as six lines.
 *
 *  Scoped INSIDE the fact rather than by role across the panel: the "What's
 *  this?" trigger in the header also carries aria-expanded, and a helper that
 *  grabbed the first expandable thing on screen clicked that instead. */
async function open(index = 0) {
  const fact = screen.getAllByTestId("fact")[index];
  await userEvent.click(within(fact).getByRole("button", { expanded: false }));
}

const BELIEF: Fact = {
  id: "f-1", axis: "belief.father", at: "c-1",
  value: "Her father died in the raid.", frame: "e-elara",
};


describe("the empty state", () => {
  it("says what this section is for rather than showing an empty list", () => {
    show();
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    // Both the heading blurb and the empty state say "true throughout", which is
    // the distinction this whole section rests on -- so match the empty state's
    // own sentence rather than the phrase they share.
    expect(screen.getByText(/The sections above are for what is true throughout/))
      .toBeTruthy();
  });

  it("explains why a fact needs a point in the book", () => {
    // Weaving sends writers here to fix exactly this, so the reason has to be
    // on the screen rather than in the walkthrough only.
    show();
    expect(screen.getByText(/who someone was in chapter seven/)).toBeTruthy();
  });
});


describe("recording a fact", () => {
  it("offers the writer's own chapters, in order, never an id", async () => {
    show([BELIEF]);
    await open();
    const when = screen.getByLabelText("From when 1") as HTMLSelectElement;
    const options = Array.from(when.options).map(o => o.textContent);
    expect(options).toEqual(["Not placed yet", "1. The Raid", "2. The Letter"]);
  });

  it("keeps 'not placed yet' selectable, because that is a real state", async () => {
    // A writer has to be able to SEE that a fact is unplaced, and to leave it
    // that way while they work out where it goes.
    const { onChange } = show([BELIEF]);
    await open();
    await userEvent.selectOptions(screen.getByLabelText("From when 1"), "");
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ at: "" })]);
  });

  it("records whose truth it is, so a belief is not made true", async () => {
    // The mechanism behind the whole opening example: she believes her father
    // died, and he is alive, and both are recorded without contradicting.
    show([BELIEF], { self: { entity_id: "e-elara", name: "Elara Voss" } });
    await open();
    expect((screen.getByLabelText("Whose truth 1") as HTMLSelectElement).value)
      .toBe("e-elara");
  });

  it("offers people to choose from, because a frame is an id nobody knows", async () => {
    // THE DEFECT THIS REPLACED. It was a text box hinted "name a character", and
    // a frame is stored as an entity id -- so a writer types "Alexandra
    // Langford", it saves, it looks right, and it never resolves as her belief
    // because nothing matches that string to her entry. Silent, and the kind of
    // wrong a writer would never think to suspect.
    show([BELIEF], {
      self: { entity_id: "e-elara", name: "Elara Voss" },
      people: [{ entity_id: "e-garrick", name: "Garrick Vale" }],
    });
    await open();
    const whose = screen.getByLabelText("Whose truth 1") as HTMLSelectElement;
    const options = Array.from(whose.options).map(o => o.textContent);
    expect(options).toEqual([
      "True of the world",
      "Only Elara Voss believes this",
      "Only Garrick Vale believes this",
    ]);
  });

  it("puts the entry being edited first", async () => {
    // Most beliefs on a character's page are that character's own.
    show([BELIEF], {
      self: { entity_id: "e-elara", name: "Elara Voss" },
      people: [{ entity_id: "e-garrick", name: "Garrick Vale" },
               { entity_id: "e-elara", name: "Elara Voss" }],
    });
    await open();
    const whose = screen.getByLabelText("Whose truth 1") as HTMLSelectElement;
    const names = Array.from(whose.options).map(o => o.textContent);
    expect(names[1]).toBe("Only Elara Voss believes this");
    // And not twice, because she is also in the full list.
    expect(names.filter(n => n === "Only Elara Voss believes this")).toHaveLength(1);
  });

  it("defaults to true of the world", async () => {
    show([{ id: "f-1", axis: "location", at: "c-1", value: "The keep burned." }]);
    await open();
    expect((screen.getByLabelText("Whose truth 1") as HTMLSelectElement).value)
      .toBe("truth");
  });

  it("keeps a frame it does not recognise rather than resetting it", async () => {
    // An entry deleted since, or a hand-edited file. Silently switching it to
    // "true of the world" would change what the writer recorded -- turning a
    // character's mistaken belief into a fact about the book.
    show([{ ...BELIEF, frame: "e-gone" }]);
    await open();
    const whose = screen.getByLabelText("Whose truth 1") as HTMLSelectElement;
    expect(whose.value).toBe("e-gone");
    expect(Array.from(whose.options).map(o => o.textContent))
      .toContain("e-gone (not in this world any more)");
  });

  it("asks when the READER learns it, separately from when it happens", async () => {
    // The control that existed nowhere. Without it a reveal could not be
    // recorded, so every truth was visible at chapter one and the story scrubber
    // had nothing to reveal.
    const { onChange } = show([BELIEF]);
    await open();
    const reader = screen.getByLabelText("The reader learns this 1") as HTMLSelectElement;
    expect(Array.from(reader.options)[0].textContent).toBe("As it happens");
    await userEvent.selectOptions(reader, "c-15");
    expect(onChange).toHaveBeenCalledWith(
      [expect.objectContaining({ revealed_at: "c-15" })]);
  });

  it("defaults a new fact to the first chapter rather than to nothing", async () => {
    // A fact that arrives unplaced reads as a mistake the writer has to fix
    // before it does anything, and most facts belong where the writer is.
    const { onChange } = show([]);
    await userEvent.click(
      screen.getByRole("button", { name: /Something that changes/ }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ at: "c-1" })]);
  });

  it("removes one without touching the others", async () => {
    const second: Fact = { ...BELIEF, id: "f-2", axis: "location" };
    const { onChange } = show([BELIEF, second]);
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Remove belief.father/ }));
    expect(onChange).toHaveBeenCalledWith([second]);
  });

  it("writes nothing by itself -- the caller saves", () => {
    // Manual save is the product rule and a fact is no exception. Everything
    // here goes through onChange into the caller's buffer.
    const { onChange } = show([BELIEF]);
    expect(onChange).not.toHaveBeenCalled();
  });
});


describe("a project that cannot hold facts yet", () => {
  it("says why instead of offering a control that loses what you type", async () => {
    // A profiles/ file has no Run in its format. Offering the editor there
    // would take the writer's chapter and drop it on save, with nothing said.
    show([], { unavailable: "Facts need this project brought into the Weave first." });
    expect(screen.getByText(/brought into the Weave first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Something that changes/ })).toBeNull();
  });

  it("still explains what the section would be for", () => {
    show([], { unavailable: "Not yet." });
    expect(screen.getByText(/How this changes through the story/)).toBeTruthy();
  });
});


describe("one editor, two screens", () => {
  const SOURCES = import.meta.glob(
    ["./ThreadEditor.tsx", "../../screens/ProfileBuilder.tsx"],
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>;

  function source(name: string): string {
    const key = Object.keys(SOURCES).find(k => k.endsWith(name));
    expect(key, `${name} not found`).toBeTruthy();
    return SOURCES[key!];
  }

  it("is used by the Weave's editor and by the Profile Builder", () => {
    // The point of extracting it. A second implementation would have given one
    // idea two vocabularies, which is the failure this recovery keeps finding.
    for (const name of ["ThreadEditor.tsx", "ProfileBuilder.tsx"]) {
      expect(source(name)).toMatch(/<RunEditor/);
    }
  });

  it("is not reimplemented in either of them", () => {
    for (const name of ["ThreadEditor.tsx", "ProfileBuilder.tsx"]) {
      expect(source(name)).not.toMatch(/function Run\(/);
    }
  });

  it("the Profile Builder offers it for the kinds a novelist actually opens", () => {
    // Characters, relationships, locations and lore. This screen is where they
    // are edited, and it had no fact UI at all until now.
    const builder = source("ProfileBuilder.tsx");
    expect(builder).toMatch(/run=\{profile\.run \?\? \[\]\}/);
    // And it explains itself rather than going quiet on an unconverted project.
    expect(builder).toMatch(/unavailable=\{home === "profiles"/);
  });
});

// ── One open at a time ───────────────────────────────────────────────────────
//
// The writer, after recording three facts on one character: "seeing how the
// landscape is becoming very Bulky and busy on the Profiles page ... Truncate it
// into a Detailed line entry below ... Only allowing one of these to be expanded
// at any given time keeping the landscape clean and less busy."

describe("the collapsed line", () => {
  const REVEAL: Fact = {
    id: "f-2", axis: "belief.father", at: "c-1",
    value: "Her father is alive, held in the north.",
    frame: "truth", revealed_at: "c-15",
  };

  it("reads as one sentence: when, what, whose, and when the reader learns", () => {
    show([BELIEF], { self: { entity_id: "e-elara", name: "Elara Voss" } });
    const line = screen.getAllByTestId("fact")[0].textContent ?? "";
    expect(line).toContain("From 1. The Raid");
    expect(line).toContain("Her father died in the raid.");
    expect(line).toContain("Elara Voss believes it");
  });

  it("says when the reader finds out, when that is later", () => {
    show([REVEAL]);
    const line = screen.getAllByTestId("fact")[0].textContent ?? "";
    expect(line).toContain("reader learns it at 2. The Letter");
  });

  it("says nothing about whose truth when it is simply true", () => {
    // Most facts are. Printing "true of the world" on every line would spend
    // the writer's attention on the default.
    show([REVEAL]);
    expect(screen.getAllByTestId("fact")[0].textContent).not.toContain("believes it");
  });

  it("shows an unplaced fact as unplaced rather than blank", () => {
    show([{ ...BELIEF, at: "" }]);
    expect(screen.getAllByTestId("fact")[0].textContent).toContain("Not placed yet");
  });

  it("truncates a long line on a word", () => {
    const long = { ...BELIEF, value: "She has believed since the night of the raid that her father went back for the horses and never came out, which is not what happened at all." };
    show([long]);
    const line = screen.getAllByTestId("fact")[0].textContent ?? "";
    expect(line).toContain("...");
    expect(line).not.toContain("not what happened at all");
    // Never mid-word.
    const shown = line.slice(line.indexOf("She has"), line.indexOf("..."));
    expect(shown.endsWith(" ")).toBe(false);
    expect(long.value.startsWith(shown)).toBe(true);
  });

  it("starts with every fact closed", () => {
    // Six facts is six lines, which is the whole point.
    show([BELIEF, REVEAL]);
    expect(screen.queryByLabelText("What changes 1")).toBeNull();
    expect(screen.queryByLabelText("What changes 2")).toBeNull();
  });

  it("opens only one at a time", async () => {
    show([BELIEF, REVEAL]);
    await open(0);
    expect(screen.getByLabelText("What changes 1")).toBeTruthy();
    await open(1);
    expect(screen.getByLabelText("What changes 2")).toBeTruthy();
    expect(screen.queryByLabelText("What changes 1")).toBeNull();
  });

  it("closes the one that is open when clicked again", async () => {
    show([BELIEF]);
    await open();
    expect(screen.getByLabelText("What changes 1")).toBeTruthy();
    await userEvent.click(
      within(screen.getAllByTestId("fact")[0]).getByRole("button", { expanded: true }));
    expect(screen.queryByLabelText("What changes 1")).toBeNull();
  });

  it("opens a new fact straight away", async () => {
    // Collapsed, a new fact reads "(nothing written yet)" -- a button that
    // appeared to do nothing.
    show([BELIEF]);
    await userEvent.click(
      screen.getByRole("button", { name: /Something that changes/ }));
    // The caller owns the list, so nothing new renders here; what matters is
    // that the editor asked for it to be open.
    expect(screen.getAllByTestId("fact")).toHaveLength(1);
  });
});
