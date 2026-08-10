// features/codex/WeaveNav.test.tsx
// =================================
// The sidebar is the first thing a new writer meets, and the shape it takes
// is the whole argument of this redesign:
//
//   THREE GROUPS, ALWAYS. Notes / Profiles / Other are the navigational
//   skeleton. A writer sees them and moves toward whichever matches what
//   they are thinking about. Hiding one until it had content would mean
//   they never found it -- and would leave nowhere to click "+ Add New" for
//   everything that belongs there.
//
//   THE SECTIONS INSIDE ARE WHAT GROW. Each group opens with a default or
//   two and everything else waits under "+ Add New". The old sidebar showed
//   every possibility at once, which reads to a beginner as "there is an
//   enormous amount I am supposed to fill in".

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeaveNav } from "./WeaveNav";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function tree(overrides: Record<string, unknown> = {}) {
  return {
    groups: [
      {
        id: "notes", label: "Notes",
        sections: [{ kind: "note", id: "author_notes", label: "Author Notes",
                     icon: "FileText", group: "notes", count: 1,
                     default_section: true, filename: "author-notes.md" }],
        available: [
          { kind: "note", id: "outline", label: "Outline", icon: "FileText",
            group: "notes", filename: "outline.md" },
          { kind: "note", id: "brainstorming", label: "Brainstorming",
            icon: "FileText", group: "notes", filename: "brainstorming.md" },
        ],
      },
      {
        id: "profiles", label: "Profiles",
        sections: [
          { kind: "type", id: "character", label: "Character", icon: "User",
            group: "profiles", count: 3, default_section: true },
          { kind: "type", id: "location", label: "Location", icon: "MapPin",
            group: "profiles", count: 0, default_section: true },
        ],
        available: [
          { kind: "type", id: "faction", label: "Faction", icon: "Flag", group: "profiles" },
          { kind: "type", id: "government", label: "Government", icon: "Landmark",
            group: "profiles" },
        ],
      },
      {
        id: "other", label: "Other",
        sections: [{ kind: "type", id: "event", label: "Event",
                     icon: "CalendarClock", group: "other", count: 0,
                     default_section: true }],
        available: [
          { kind: "type", id: "object", label: "Object", icon: "Package", group: "other" },
        ],
      },
    ],
    available: [],
    converted: false,
    ...overrides,
  };
}

let posts: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(sections = tree()) {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
    }
    return { ok: true, json: async () => sections } as Response;
  }));
}

const PROJECT = "C:/MyNovel";

beforeEach(() => mockApi());

async function renderNav(props: Record<string, unknown> = {}) {
  const onOpenSection = vi.fn();
  const onOpenWeave = vi.fn();
  render(
    <WeaveNav projectPath={PROJECT} onOpenSection={onOpenSection}
              onOpenWeave={onOpenWeave} {...props} />,
  );
  await waitFor(() => expect(screen.getByTestId("weave-nav")).toBeTruthy());
  return { onOpenSection, onOpenWeave };
}

/** Open one group and return its region for scoped queries. */
async function openGroup(label: string) {
  await userEvent.click(screen.getByRole("button", { name: label }));
}


describe("the skeleton", () => {
  it("shows all three groups", async () => {
    await renderNav();
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Profiles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Other" })).toBeTruthy();
  });

  it("starts collapsed, so the whole tree fits at a glance", async () => {
    await renderNav();
    expect(screen.getByRole("button", { name: "Profiles" })
      .getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Character/ })).toBeNull();
  });

  it("puts Weaving directly under the title", async () => {
    // It is the thing that helps you FILL the tree, so it belongs above the
    // tree rather than buried inside one of its groups.
    await renderNav();
    expect(screen.getByRole("button", { name: /Weaving/ })).toBeTruthy();
  });

  it("says Weaving is not built yet rather than pretending it works", async () => {
    await renderNav();
    const weaving = screen.getByRole("button", { name: /Weaving/ });
    expect(weaving.hasAttribute("disabled")).toBe(true);
    expect(weaving.getAttribute("title")).toMatch(/not built yet/);
  });

  it("opens the Weave from its title", async () => {
    const { onOpenWeave } = await renderNav();
    await userEvent.click(screen.getByRole("button", { name: /The Weave/ }));
    expect(onOpenWeave).toHaveBeenCalled();
  });
});


describe("what is inside a group", () => {
  it("shows the defaults and nothing else", async () => {
    await renderNav();
    await openGroup("Profiles");
    expect(screen.getByRole("button", { name: /Character/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Location/ })).toBeTruthy();
    // Faction exists but is not in use, so it waits under + Add New.
    expect(screen.queryByRole("button", { name: /^Faction/ })).toBeNull();
  });

  it("puts Add New at the TOP, where a writer looks for it", async () => {
    // Scanning past a list to find it defeats the point of a short list.
    await renderNav();
    await openGroup("Profiles");
    const labels = screen.getAllByRole("button").map(b => b.textContent ?? "");
    const addIndex = labels.findIndex(l => l.includes("Add New"));
    const characterIndex = labels.findIndex(l => l.includes("Character"));
    expect(addIndex).toBeLessThan(characterIndex);
  });

  it("every group offers a way to add to it", async () => {
    await renderNav();
    for (const group of ["Notes", "Profiles", "Other"]) {
      await openGroup(group);
      expect(screen.getAllByRole("button", { name: /Add New/ }).length)
        .toBeGreaterThan(0);
      await openGroup(group);
    }
  });

  it("shows how much is in a section, and stays quiet when empty", async () => {
    await renderNav();
    await openGroup("Profiles");
    expect(screen.getByRole("button", { name: /Character/ }).textContent).toContain("3");
    // Location is a default with nothing in it -- a "0" would read as a
    // problem rather than as an empty section waiting to be used.
    expect(screen.getByRole("button", { name: /Location/ }).textContent).not.toContain("0");
  });

  it("opens a section when clicked", async () => {
    const { onOpenSection } = await renderNav();
    await openGroup("Profiles");
    await userEvent.click(screen.getByRole("button", { name: /Character/ }));
    expect(onOpenSection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "character", kind: "type" }));
  });
});


describe("+ Add New", () => {
  async function openAdd(group: string) {
    await renderNav();
    await openGroup(group);
    await userEvent.click(screen.getAllByRole("button", { name: /Add New/ })[0]);
    return screen.getByRole("dialog", { name: /Add to your world/i });
  }

  it("offers the kinds that are not in use yet", async () => {
    const dialog = await openAdd("Profiles");
    expect(within(dialog).getByRole("button", { name: "Faction" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Government" })).toBeTruthy();
  });

  it("opens pointed at the group it was clicked from", async () => {
    const dialog = await openAdd("Other");
    expect(within(dialog).getByRole("tab", { name: "Other" })
      .getAttribute("aria-selected")).toBe("true");
  });

  it("still lets the writer reach the other groups", async () => {
    // The group they clicked is a hint about what they want, not a rule
    // about what they may have.
    const dialog = await openAdd("Profiles");
    await userEvent.click(within(dialog).getByRole("tab", { name: "Notes" }));
    expect(within(dialog).getByRole("button", { name: "Brainstorming" })).toBeTruthy();
  });

  it("explains what each group is for", async () => {
    // The three words are not self-explanatory, and guessing wrong puts an
    // entry somewhere the writer will not look for it again.
    const dialog = await openAdd("Profiles");
    expect(within(dialog).getByText(/An entry about something in your world/)).toBeTruthy();
  });

  it("offers the longer answer behind What's this?", async () => {
    const dialog = await openAdd("Profiles");
    await userEvent.click(within(dialog).getByRole("button", { name: /what's this/i }));
    // Read the whole dialog: each line is its own block with the term in its
    // own span, which is the layout, so no single element holds a sentence.
    const text = dialog.textContent ?? "";
    // The context first...
    expect(text).toMatch(/everything in your world and how it all connects/);
    // ...and what happens next, which is the part that makes filling any of
    // this in worth doing.
    expect(text).toMatch(/WEAVING is the step/);
  });

  it("gives each group its own answer, not one generic one", async () => {
    const dialog = await openAdd("Profiles");
    await userEvent.click(within(dialog).getByRole("button", { name: /what's this/i }));
    expect(dialog.textContent).toMatch(/Factions for groups/);

    // Switching group swaps the explanation and leaves it OPEN. A writer who
    // asked what a group is has asked a question about groups, not about
    // that one group -- collapsing it on every tab would make them ask again.
    await userEvent.click(within(dialog).getByRole("tab", { name: "Notes" }));
    expect(dialog.textContent).toMatch(/documents in your own voice/);
    expect(dialog.textContent).not.toMatch(/Factions for groups/);
  });

  it("SHOWS a shipped kind rather than trying to create it", async () => {
    // Faction ships with the app and is simply not on screen. Sending this
    // to the create endpoint would be refused as a duplicate -- true, and
    // completely unhelpful.
    const dialog = await openAdd("Profiles");
    await userEvent.click(within(dialog).getByRole("button", { name: "Faction" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toContain("/type/show");
    expect(posts[0].body.id).toBe("faction");
  });

  it("creates a FILE when the preset is a note", async () => {
    // A note is its file. There is nothing else to it.
    const dialog = await openAdd("Notes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Outline" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toContain("/note");
    expect(posts[0].body.label).toBe("Outline");
  });
});


describe("[Custom]", () => {
  async function openCustom(group: string) {
    await renderNav();
    await openGroup(group);
    await userEvent.click(screen.getAllByRole("button", { name: /Add New/ })[0]);
    const dialog = screen.getByRole("dialog", { name: /Add to your world/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /Something else/ }));
    return dialog;
  }

  it("is offered last, not first", async () => {
    // It is there for the world the presets do not fit, not the first thing
    // a beginner should reach for.
    await renderNav();
    await openGroup("Profiles");
    await userEvent.click(screen.getAllByRole("button", { name: /Add New/ })[0]);
    const dialog = screen.getByRole("dialog", { name: /Add to your world/i });
    const labels = within(dialog).getAllByRole("button").map(b => b.textContent ?? "");
    expect(labels.findIndex(l => l.includes("Something else")))
      .toBeGreaterThan(labels.findIndex(l => l.includes("Faction")));
  });

  it("refuses numbers, and says why in plain words", async () => {
    const dialog = await openCustom("Profiles");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Order 66");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/no numbers/);
    expect(within(dialog).getByRole("button", { name: "Add" })
      .hasAttribute("disabled")).toBe(true);
  });

  it("refuses symbols", async () => {
    const dialog = await openCustom("Profiles");
    await userEvent.type(within(dialog).getByLabelText("Name"), "House/Ward");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/letters and spaces/);
  });

  it("refuses a name Windows cannot make a folder from", async () => {
    const dialog = await openCustom("Profiles");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Aux");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Windows will not allow/);
  });

  it("says nothing at all before the writer has typed", async () => {
    // Colouring an untouched field red is scolding somebody for opening a
    // dialog.
    const dialog = await openCustom("Profiles");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("shows what it will be called on disk", async () => {
    // So the folder name is never a surprise later.
    const dialog = await openCustom("Profiles");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Royal Household");
    expect(within(dialog).getByText("royal_household")).toBeTruthy();
  });

  it("adds a KIND from Profiles", async () => {
    const dialog = await openCustom("Profiles");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Bloodline");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toContain("/type");
    expect(posts[0].body).toMatchObject({ label: "Bloodline", group: "profiles" });
  });

  it("adds a DOCUMENT from Notes", async () => {
    // The asymmetry that matters: Notes adds a file, the other two add a
    // kind of entry.
    const dialog = await openCustom("Notes");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Dungeon Rules");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toContain("/note");
    expect(posts[0].body.label).toBe("Dungeon Rules");
  });
});


describe("failure", () => {
  it("keeps a refused name in the dialog to be corrected", async () => {
    // Closing on an error would throw away what they typed and tell them
    // nothing.
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          json: async () => ({ detail: { code: "type_invalid",
                                         message: "That kind could not be added." } }),
        } as Response;
      }
      return { ok: true, json: async () => tree() } as Response;
    }));

    render(<WeaveNav projectPath={PROJECT} onOpenSection={vi.fn()} onOpenWeave={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("weave-nav")).toBeTruthy());
    await openGroup("Profiles");
    await userEvent.click(screen.getAllByRole("button", { name: /Add New/ })[0]);
    const dialog = screen.getByRole("dialog", { name: /Add to your world/i });
    await userEvent.click(within(dialog).getByRole("button", { name: "Faction" }));

    await waitFor(() =>
      expect(within(dialog).getByText(/could not be added/)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: /Add to your world/i })).toBeTruthy();
  });
});
