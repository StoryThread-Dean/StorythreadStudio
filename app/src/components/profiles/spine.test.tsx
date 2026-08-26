// components/profiles/spine.test.tsx -- picking a personality, and roles
// ======================================================================
// Spec: docs/character-spine-spec.md.
//
// Both halves of a live-testing report. The writer liked both ideas and could
// use neither: the personality type inserted one indivisible paragraph and then
// forgot itself, and adding a story role erased the roles already there.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { SpineFacetPicker } from "./SpineFacetPicker";
import { SpinePickers } from "./SpinePickers";
import { RolePicker } from "./RolePicker";
import { QuickBuildPanel } from "./QuickBuildPanel";
import { ENNEAGRAM_OPTIONS, addRole, splitRoles } from "../../data/characterSpines";

afterEach(cleanup);

const TYPE_ONE = ENNEAGRAM_OPTIONS.find(o => o.id === "e1")!;

function showPicker(existingText = "") {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<SpineFacetPicker option={TYPE_ONE} existingText={existingText}
                           onInsert={onInsert} onClose={onClose} />);
  return { onInsert, onClose };
}

describe("picking what fits", () => {
  it("starts with nothing ticked", () => {
    // It writes into the writer's own file. Same rule the Sweep follows.
    showPicker();
    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
    expect((screen.getByTestId("spine-insert") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("offers every line of the type separately", () => {
    // THE REPORT. Eight facets for type 1, three of them habits, so the crooked
    // picture frame can go while the rest stays.
    showPicker();
    expect(screen.getAllByRole("checkbox")).toHaveLength(TYPE_ONE.facets!.length);
    expect(screen.getByLabelText("Notices the crooked picture frame in any room."))
      .toBeTruthy();
  });

  it("inserts only the ticked lines, in order", () => {
    const { onInsert } = showPicker();
    fireEvent.click(screen.getByLabelText("Wants to be good and beyond reproach."));
    fireEvent.click(screen.getByLabelText("Apologizes rarely but corrects often."));
    fireEvent.click(screen.getByTestId("spine-insert"));

    const facets = onInsert.mock.calls[0][0];
    expect(facets.map((f: { text: string }) => f.text)).toEqual([
      "Wants to be good and beyond reproach.",
      "Apologizes rarely but corrects often.",
    ]);
    // Saki's edit: the picture frame is NOT in what was inserted.
    expect(JSON.stringify(facets)).not.toContain("picture frame");
  });

  it("Essentials ticks three lines and writes nothing", () => {
    const { onInsert } = showPicker();
    fireEvent.click(screen.getByTestId("spine-essentials"));
    const ticked = screen.getAllByRole("checkbox")
      .filter(b => (b as HTMLInputElement).checked);
    expect(ticked).toHaveLength(3);
    // Ticks are not writes. Nothing has been inserted yet.
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByTestId("spine-insert").textContent).toContain("3");
  });

  it("Everything is still one click, for whoever wanted the old behaviour", () => {
    const { onInsert } = showPicker();
    fireEvent.click(screen.getByTestId("spine-everything"));
    fireEvent.click(screen.getByTestId("spine-insert"));
    expect(onInsert.mock.calls[0][0]).toHaveLength(TYPE_ONE.facets!.length);
  });

  it("greys a line already in the character, and says why", () => {
    // From the LIVE BUFFER, so an unsaved insert greys immediately.
    showPicker("Wants to be good and beyond reproach.");
    const box = screen.getByLabelText("Wants to be good and beyond reproach.");
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByTestId("spine-facet-taken").length).toBeGreaterThan(0);
  });

  it("offers a line again once the writer has edited it", () => {
    // The correct failure direction: offering twice costs a glance, greying a
    // rewritten line would hide a facet never taken.
    showPicker("Wants to be good, mostly, and hates being caught out.");
    const box = screen.getByLabelText("Wants to be good and beyond reproach.");
    expect((box as HTMLInputElement).disabled).toBe(false);
  });

  it("says so when the whole type is already in", () => {
    showPicker(TYPE_ONE.summary);
    expect(screen.getByTestId("spine-all-taken")).toBeTruthy();
    expect(screen.queryByTestId("spine-essentials")).toBeNull();
  });
});

describe("the personality control itself", () => {
  it("shows the stored type instead of forgetting it", () => {
    // THE REPORTED BUG: "the functionality and purpose of picking the ennegram
    // never stays put". It was a select pinned to "" forever.
    render(<SpinePickers enneagram="e1" onEnneagramChange={vi.fn()}
                         onInsertFacets={vi.fn()} personalityText="" />);
    expect((screen.getByLabelText("Personality type") as HTMLSelectElement).value)
      .toBe("e1");
  });

  it("does not write any text when the type is chosen", () => {
    // Choosing a type is a fact about the character; inserting sentences is a
    // decision about the page. Keeping them separate is the fix.
    const onInsertFacets = vi.fn();
    const onEnneagramChange = vi.fn();
    render(<SpinePickers enneagram="" onEnneagramChange={onEnneagramChange}
                         onInsertFacets={onInsertFacets} personalityText="" />);
    fireEvent.change(screen.getByLabelText("Personality type"),
                     { target: { value: "e3" } });
    expect(onEnneagramChange).toHaveBeenCalledWith("e3");
    expect(onInsertFacets).not.toHaveBeenCalled();
  });

  it("cannot open the facet picker with no type chosen", () => {
    render(<SpinePickers enneagram="" onEnneagramChange={vi.fn()}
                         onInsertFacets={vi.fn()} personalityText="" />);
    expect((screen.getByTestId("spine-open-facets") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("offers no Story Role select, because there is one Role control now", () => {
    render(<SpinePickers enneagram="e1" onEnneagramChange={vi.fn()}
                         onInsertFacets={vi.fn()} personalityText="" />);
    expect(within(screen.getByTestId("spine-pickers"))
      .queryByLabelText(/story role/i)).toBeNull();
  });
});

describe("adding roles without losing them", () => {
  it("appends rather than overwriting", () => {
    // THE REPORT, as a unit: "choosing Everyman literally erases what currently
    // exists in Role."
    expect(addRole("Merchant, Red Herring", "Everyman"))
      .toBe("Merchant, Red Herring, Everyman");
  });

  it("does nothing when the role is already there, whatever the casing", () => {
    expect(addRole("Merchant, Red Herring", "merchant"))
      .toBe("Merchant, Red Herring");
    expect(addRole("Merchant,  Red Herring ", "Red Herring"))
      .toBe("Merchant,  Red Herring ");
  });

  it("handles an empty field and an empty pick", () => {
    expect(addRole("", "Merchant")).toBe("Merchant");
    expect(addRole(undefined, "Merchant")).toBe("Merchant");
    expect(addRole("Merchant", "  ")).toBe("Merchant");
  });

  it("splits a field into its parts and drops the gaps", () => {
    expect(splitRoles("Merchant, , Red Herring ")).toEqual(["Merchant", "Red Herring"]);
    expect(splitRoles("")).toEqual([]);
  });
});

describe("the one Role control", () => {
  function showRoles(role = "") {
    const onChange = vi.fn();
    const onInsertGuidance = vi.fn();
    render(<RolePicker role={role} onChange={onChange}
                       onInsertGuidance={onInsertGuidance} />);
    return { onChange, onInsertGuidance };
  }

  it("adds Saki's three roles from three different groups", () => {
    // The acceptance case. Merchant was not in the old list at all.
    const { onChange } = showRoles("Merchant, Red Herring");
    fireEvent.change(screen.getByTestId("role-add"),
                     { target: { value: "Everyman" } });
    expect(onChange).toHaveBeenCalledWith("Merchant, Red Herring, Everyman");
  });

  it("explains every role, not just the archetypes", () => {
    showRoles();
    fireEvent.click(screen.getByTestId("role-help-toggle"));
    const help = screen.getByTestId("role-help");
    // A trade role and a mystery role, neither of which is an archetype and
    // neither of which had any help before.
    expect(help.textContent).toContain("Merchant");
    expect(help.textContent).toContain("Suspect");
  });

  it("keeps the archetype guidance and inserts it only when asked", () => {
    const { onChange, onInsertGuidance } = showRoles();
    fireEvent.click(screen.getByTestId("role-help-toggle"));
    fireEvent.click(screen.getByTestId("role-guidance-Everyman"));
    expect(onInsertGuidance).toHaveBeenCalledTimes(1);
    expect(onInsertGuidance.mock.calls[0][0]).toBe("Everyman");
    expect(onInsertGuidance.mock.calls[0][1]).toContain("Weakness to write toward");
    // Inserting guidance is NOT picking the role. It used to be both, plus an
    // overwrite of the Role field.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks a role already on the character rather than hiding it", () => {
    showRoles("Merchant");
    const option = within(screen.getByTestId("role-add"))
      .getByRole("option", { name: /Merchant \(added\)/ });
    expect((option as HTMLOptionElement).disabled).toBe(true);
  });
});

describe("the role help is a genuine popout", () => {
  function showRoles(role = "") {
    const onChange = vi.fn();
    render(<RolePicker role={role} onChange={onChange}
                       onInsertGuidance={vi.fn()} />);
    return { onChange };
  }

  it("floats out of the flow instead of growing the card", () => {
    // THE REPORT: "the What'sThis opens within the entire card for
    // Name/Role/Sex/age/Status causing a massive distortion of the box/card."
    // It was mt-1.5 in the flow, inside the header grid, so opening it
    // stretched the card -- the exact mistake Explain.tsx documents at the top
    // of its own file.
    showRoles();
    fireEvent.click(screen.getByTestId("role-help-toggle"));
    const panel = screen.getByTestId("role-help");
    expect(panel.className).toContain("absolute");
    expect(panel.className).toContain("z-50");
    // A floating panel over other content needs its own ground, or the card
    // shows through it.
    expect(panel.className).toMatch(/bg-bg-panel/);
  });

  it("puts its label where the other field labels are", () => {
    // Requested: "Reposition the What'sThis? text to be above the Dropdown
    // just like how Name is above the fillin box."
    showRoles();
    const trigger = screen.getByTestId("role-help-toggle");
    const select = screen.getByTestId("role-add");
    // The trigger comes BEFORE the control in document order, which is what
    // puts it on the label line.
    expect(trigger.compareDocumentPosition(select)
           & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.className).toContain("mb-1");
  });

  it("closes on Escape, like every other floating panel", () => {
    showRoles();
    fireEvent.click(screen.getByTestId("role-help-toggle"));
    expect(screen.queryByTestId("role-help")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("role-help")).toBeNull();
  });
});

describe("Quick Build's Story Role", () => {
  function showQuickBuild() {
    render(<QuickBuildPanel onInsert={vi.fn()} onInsertRoleSummary={vi.fn()} />);
  }

  it("says what it does instead of saying 'weights the rolls'", () => {
    // The report was a question: "what does the text above it mean {weights the
    // rolls}? Does it physically effect the [Reroll] below it? if so, for which
    // section? how does it effect the reroll?" Jargon that raises four
    // questions is not a label.
    showQuickBuild();
    const panel = screen.getByTestId("quick-build-panel");
    expect(panel.textContent).not.toContain("weights the rolls");
    expect(panel.textContent).toMatch(/mixes lines that suit this role/i);
    // Answers "which section" and "does it affect reroll" on the label itself.
    expect(panel.textContent).toMatch(/every row below/i);
    expect(panel.textContent).toMatch(/re-rolls straight away/i);
  });

  it("stays quiet about the tier until a tier is actually on", () => {
    showQuickBuild();
    expect(screen.queryByTestId("quickbuild-role-inactive")).toBeNull();
  });
});
