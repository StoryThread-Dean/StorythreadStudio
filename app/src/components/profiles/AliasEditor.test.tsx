// components/profiles/AliasEditor.test.tsx -- typing in the other names
// ======================================================================
// Spec: docs/weave-spec.md, appendix 2, section A4.
//
// The report: the alias machinery has existed since v2.0.0 and only Weaving
// could reach it, because every route started from a word the scan found in the
// manuscript. A writer building the world before chapter 1 has no manuscript
// and knows the nicknames already.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AliasEditor } from "./AliasEditor";

afterEach(cleanup);

function show(aliases: string[] = [], taken?: Map<string, string>) {
  const onChange = vi.fn();
  render(<AliasEditor aliases={aliases} onChange={onChange}
                      name="Gwendolyn Barksdale" taken={taken} />);
  return { onChange };
}

describe("typing in a name", () => {
  it("adds one, and adds it to what is already there", () => {
    const { onChange } = show(["Gwen"]);
    fireEvent.change(screen.getByLabelText("Add another name"),
                     { target: { value: "Willow" } });
    fireEvent.click(screen.getByTestId("alias-add"));
    expect(onChange).toHaveBeenCalledWith(["Gwen", "Willow"]);
  });

  it("takes Enter, because three nicknames should not need three trips", () => {
    const { onChange } = show([]);
    const input = screen.getByLabelText("Add another name");
    fireEvent.change(input, { target: { value: "Gwen" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Gwen"]);
  });

  it("tidies whitespace rather than storing it", () => {
    const { onChange } = show([]);
    fireEvent.change(screen.getByLabelText("Add another name"),
                     { target: { value: "  the   Ash  " } });
    fireEvent.click(screen.getByTestId("alias-add"));
    expect(onChange).toHaveBeenCalledWith(["the Ash"]);
  });

  it("shows each one with a way to take it back off", () => {
    const { onChange } = show(["Gwen", "Willow"]);
    fireEvent.click(screen.getByLabelText("Remove Gwen"));
    expect(onChange).toHaveBeenCalledWith(["Willow"]);
  });

  it("does nothing with an empty box", () => {
    const { onChange } = show([]);
    expect((screen.getByTestId("alias-add") as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByTestId("alias-add"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("one word cannot mean two things", () => {
  it("refuses a word another entry already answers to, and names it", () => {
    // The route's own rule and very nearly its own wording, because it explains
    // the CONSEQUENCE rather than just refusing: a mention of an ambiguous word
    // binds to neither entry, so accepting it quietly would put a name in the
    // world that looks recorded and never matches again.
    const { onChange } = show([], new Map([["gwen", "Gwendolyn Ashby"]]));
    fireEvent.change(screen.getByLabelText("Add another name"),
                     { target: { value: "Gwen" } });
    fireEvent.click(screen.getByTestId("alias-add"));

    expect(onChange).not.toHaveBeenCalled();
    const error = screen.getByTestId("alias-error").textContent ?? "";
    expect(error).toContain("Gwendolyn Ashby");
    expect(error).toMatch(/cannot mean two things/i);
  });

  it("treats a word this entry already has as done, not as a failure", () => {
    // The writer's belief about their own world is correct and there is nothing
    // to do. Same stance POST /alias takes.
    const { onChange } = show(["Gwen"]);
    fireEvent.change(screen.getByLabelText("Add another name"),
                     { target: { value: "gwen" } });
    fireEvent.click(screen.getByTestId("alias-add"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("alias-error").textContent)
      .toMatch(/already answers to/i);
  });

  it("refuses the entry's own name", () => {
    const { onChange } = show([]);
    fireEvent.change(screen.getByLabelText("Add another name"),
                     { target: { value: "Gwendolyn Barksdale" } });
    fireEvent.click(screen.getByTestId("alias-add"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the complaint once the writer starts typing again", () => {
    show([], new Map([["gwen", "Gwendolyn Ashby"]]));
    const input = screen.getByLabelText("Add another name");
    fireEvent.change(input, { target: { value: "Gwen" } });
    fireEvent.click(screen.getByTestId("alias-add"));
    expect(screen.queryByTestId("alias-error")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Gwenn" } });
    expect(screen.queryByTestId("alias-error")).toBeNull();
  });
});

describe("what it deliberately will not do", () => {
  it("guesses nothing from the name", () => {
    // "Gwen" is not offered because the name is Gwendolyn. A nickname the
    // writer did not choose is one they would never notice was wrong -- and a
    // wrong alias is invisible, because being invisible is what a correct one
    // does.
    show([]);
    expect((screen.getByLabelText("Add another name") as HTMLInputElement).value)
      .toBe("");
    expect(screen.queryByTestId("alias-list")).toBeNull();
  });

  it("explains itself, like every other feature", () => {
    show([]);
    expect(screen.getByLabelText("What's this?")).toBeTruthy();
  });
});

describe("the empty state", () => {
  it("instructs rather than showing a plausible name", () => {
    // Reported: the placeholder read "Jim", and a placeholder that looks like a
    // filled-in value is one a writer reads as data -- "why does the character
    // I just created already have the alias Jim?" The name field directly above
    // is the writer's own, so a plausible name under it reads as something the
    // app decided for them.
    show([]);
    const input = screen.getByLabelText("Add another name") as HTMLInputElement;
    expect(input.placeholder).toBe("Alias or nickname used");
    // And the field really is empty, not merely showing grey text.
    expect(input.value).toBe("");
  });
});
