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
                     default_section: true, filename: "author-notes.md",
                     // A document the app opens by name: removable, not
                     // renameable.
                     shipped: true, rename: "none", removal: "trash" }],
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
            group: "profiles", count: 3, default_section: true,
            shipped: true, rename: "label", removal: "hide" },
          { kind: "type", id: "location", label: "Location", icon: "MapPin",
            group: "profiles", count: 0, default_section: true,
            shipped: true, rename: "label", removal: "hide" },
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
                     default_section: true,
                     shipped: true, rename: "label", removal: "hide" }],
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
/** Every write, with its method -- rename is a PATCH and remove is a DELETE,
 *  and both need checking. */
let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(sections: Record<string, unknown> = tree()) {
  posts = [];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, method, body });
      if (method === "POST") posts.push({ url, body });
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

/**
 * The button that OPENS a section, not the one that opens its menu.
 *
 * Every row now has both, so /Character/ matches two things. Filtering by the
 * settings label rather than by position, because the position is a layout
 * detail and the label is a promise.
 */
function row(name: string): HTMLElement {
  const found = screen.getAllByRole("button", { name: new RegExp(name) })
    .filter(b => !(b.getAttribute("aria-label") ?? "").endsWith("settings"));
  if (found.length !== 1) {
    throw new Error(`expected one ${name} row, found ${found.length}`);
  }
  return found[0];
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

  it("disables Weaving honestly when nothing is wired to open it", async () => {
    // This test used to pin the string "Weaving is not built yet" -- which
    // was TRUE when written and then outlived the build by two redesigns, a
    // pinned lie the suite kept green. Weaving shipped; the disabled state
    // survives only for a mount with no handler, and its words must not
    // claim otherwise.
    await renderNav();
    const weaving = screen.getByRole("button", { name: /Weaving/ });
    expect(weaving.hasAttribute("disabled")).toBe(true);
    expect(weaving.getAttribute("title")).toMatch(/not available/);
    expect(weaving.getAttribute("title")).not.toMatch(/not built/);
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
    expect(row("Character")).toBeTruthy();
    expect(row("Location")).toBeTruthy();
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
    expect(row("Character").textContent).toContain("3");
    // Location is a default with nothing in it -- a "0" would read as a
    // problem rather than as an empty section waiting to be used.
    expect(row("Location").textContent).not.toContain("0");
  });

  it("opens a section when clicked", async () => {
    const { onOpenSection } = await renderNav();
    await openGroup("Profiles");
    await userEvent.click(row("Character"));
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


describe("fixing a typo", () => {
  // "Magic Sysstem" is the case this exists for. A typo in a section name
  // feels permanent in a way it has no right to be, and a writer who cannot
  // fix it either lives with it or loses whatever is inside it.

  /** A world containing the writer's own additions -- a misspelt kind and a
   *  misspelt note -- alongside the sections the app itself depends on. */
  function typoTree(count = 0) {
    const base = tree();
    const groups = base.groups.map(group => {
      if (group.id === "notes") {
        return { ...group, sections: [...group.sections,
          { kind: "note", id: "dungeon_rulez", label: "Dungeon Rulez",
            icon: "FileText", group: "notes", count: 0,
            default_section: false, filename: "dungeon-rulez.md",
            shipped: false, rename: "full", removal: "trash" }] };
      }
      if (group.id === "other") {
        return { ...group, sections: [...group.sections,
          { kind: "type", id: "magic_sysstem", label: "Magic Sysstems",
            icon: "Sparkles", group: "other", count,
            default_section: false,
            shipped: false, rename: "full", removal: "delete" }] };
      }
      return group;
    });
    return { ...base, groups };
  }

  async function openMenu(name: string, group: string, count = 0) {
    mockApi(typoTree(count));
    await renderNav();
    await openGroup(group);
    await userEvent.click(screen.getByRole("button", { name: `${name} settings` }));
    return screen.getByRole("dialog", { name: `${name} settings` });
  }

  it("offers a menu on every row, including the app's own", async () => {
    // The writer found this as a cosmetic bug: rows with no menu had nothing
    // holding the space one occupies, so "Characters 13" sat flush against the
    // edge while "Factions 2" sat a menu-width in from it. Every row has the
    // menu now, and what it offers is per row.
    mockApi(typoTree());
    await renderNav();
    await openGroup("Profiles");
    expect(screen.getByRole("button", { name: "Character settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Location settings" })).toBeTruthy();
  });

  it("offers a shipped kind a new NAME rather than a new identity", async () => {
    // Characters can be called anything. Its id and folder cannot move --
    // profiles.py, the migration and the Profile Builder all name "character"
    // directly -- so the menu says so instead of implying a full rename.
    const dialog = await openMenu("Character", "Profiles", 3);
    await userEvent.click(within(dialog)
      .getByRole("button", { name: /Change what it is called/ }));
    expect(within(dialog).getByText(/Only the name changes/)).toBeTruthy();
    expect(within(dialog).getByText(/folder and everything in it stay/)).toBeTruthy();
  });

  it("hides a shipped kind instead of deleting part of the app", async () => {
    const dialog = await openMenu("Location", "Profiles");
    await userEvent.click(within(dialog)
      .getByRole("button", { name: /Hide this section/ }));
    expect(within(dialog).getByText(/bring it back any time from Add New/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Hide it" }));

    const hide = calls.find(c => c.url.includes("/type/show"));
    expect(hide?.body).toMatchObject({ id: "location", show: false });
    // Nothing was deleted.
    expect(calls.some(c => c.method === "DELETE")).toBe(false);
  });

  it("says a section that holds work will stay in the sidebar", async () => {
    // Hiding turns off "show even when empty". A section shows anyway while it
    // holds something, and a button that appears to do nothing is worse than
    // one that explains itself.
    const dialog = await openMenu("Character", "Profiles", 3);
    await userEvent.click(within(dialog)
      .getByRole("button", { name: /Hide this section/ }));
    expect(within(dialog).getByText(/stays in the sidebar while they are in it/))
      .toBeTruthy();
  });

  it("will not offer to rename a document the app opens by name", async () => {
    // notes/outline.md carries the book's word target in its frontmatter. The
    // reason is shown rather than the button merely being absent.
    const dialog = await openMenu("Author Notes", "Notes");
    expect(within(dialog).queryByRole("button", { name: /Rename|called/ })).toBeNull();
    expect(within(dialog).getByText(/opens by name, so its name is fixed/))
      .toBeTruthy();
    // And the other option survives the refusal.
    expect(within(dialog).getByRole("button", { name: /Remove it/ })).toBeTruthy();
  });

  it("offers one on a section the writer added", async () => {
    mockApi(typoTree());
    await renderNav();
    await openGroup("Other");
    expect(screen.getByRole("button", { name: "Magic Sysstems settings" })).toBeTruthy();
  });

  it("renames a kind by its id", async () => {
    const dialog = await openMenu("Magic Sysstems", "Other");
    await userEvent.click(within(dialog).getByRole("button", { name: /Rename/ }));
    await userEvent.clear(within(dialog).getByLabelText("New name"));
    await userEvent.type(within(dialog).getByLabelText("New name"), "Magic System");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ id: "magic_sysstem", label: "Magic System" });
    expect(calls[0].body.filename).toBeUndefined();
  });

  it("renames a note by its file", async () => {
    // The asymmetry that matters: a kind IS an id, a note IS a file.
    const dialog = await openMenu("Dungeon Rulez", "Notes");
    await userEvent.click(within(dialog).getByRole("button", { name: /Rename/ }));
    await userEvent.clear(within(dialog).getByLabelText("New name"));
    await userEvent.type(within(dialog).getByLabelText("New name"), "Dungeon Rules");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].body).toMatchObject({ filename: "dungeon-rulez.md",
                                          label: "Dungeon Rules" });
    expect(calls[0].body.id).toBeUndefined();
  });

  it("holds the old name ready to be corrected", async () => {
    // Typing the whole thing again to fix one letter is the annoying answer.
    const dialog = await openMenu("Magic Sysstems", "Other");
    await userEvent.click(within(dialog).getByRole("button", { name: /Rename/ }));
    expect((within(dialog).getByLabelText("New name") as HTMLInputElement).value)
      .toBe("Magic Sysstems");
  });

  it("refuses a new name the same way it refuses a new one", async () => {
    // The rules cannot differ between adding and renaming, or a writer could
    // rename their way into a name the app would not have let them create.
    const dialog = await openMenu("Magic Sysstems", "Other");
    await userEvent.click(within(dialog).getByRole("button", { name: /Rename/ }));
    await userEvent.clear(within(dialog).getByLabelText("New name"));
    await userEvent.type(within(dialog).getByLabelText("New name"), "System 2");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/no numbers/);
    expect(within(dialog).getByRole("button", { name: "Save" })
      .hasAttribute("disabled")).toBe(true);
  });

  it("says the entries come with it", async () => {
    // A rename that quietly moved files would be alarming to notice
    // afterwards.
    const dialog = await openMenu("Magic Sysstems", "Other", 4);
    await userEvent.click(within(dialog).getByRole("button", { name: /Rename/ }));
    expect(within(dialog).getByText(/All 4 entries come with it/)).toBeTruthy();
  });
});


describe("removing a section", () => {
  function typoTree(count = 0) {
    const base = tree();
    const groups = base.groups.map(group => {
      if (group.id === "notes") {
        return { ...group, sections: [...group.sections,
          { kind: "note", id: "dungeon_rules", label: "Dungeon Rules",
            icon: "FileText", group: "notes", count: 0,
            default_section: false, filename: "dungeon-rules.md",
            shipped: false, rename: "full", removal: "trash" }] };
      }
      if (group.id === "other") {
        return { ...group, sections: [...group.sections,
          { kind: "type", id: "bloodline", label: "Bloodlines",
            icon: "Sparkles", group: "other", count, default_section: false,
            shipped: false, rename: "full", removal: "delete" }] };
      }
      return group;
    });
    return { ...base, groups };
  }

  async function openConfirm(name: string, group: string, count = 0,
                             sections?: Record<string, unknown>) {
    mockApi(sections ?? typoTree(count));
    await renderNav();
    await openGroup(group);
    await userEvent.click(screen.getByRole("button", { name: `${name} settings` }));
    const dialog = screen.getByRole("dialog", { name: `${name} settings` });
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove it/ }));
    return dialog;
  }

  it("asks before removing anything", async () => {
    const dialog = await openConfirm("Bloodlines", "Other");
    expect(within(dialog).getByText(/Remove Bloodlines\?/)).toBeTruthy();
    expect(calls.length).toBe(0);
  });

  it("lets the writer back out", async () => {
    const dialog = await openConfirm("Bloodlines", "Other");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(calls.length).toBe(0);
  });

  it("says it is empty when it is", async () => {
    const dialog = await openConfirm("Bloodlines", "Other");
    expect(within(dialog).getByText(/It is empty, so nothing is lost/)).toBeTruthy();
  });

  it("warns before the click when the section holds writing", async () => {
    // The backend refuses this outright. Saying so first means the writer
    // learns the rule rather than meeting an error.
    const dialog = await openConfirm("Bloodlines", "Other", 2);
    expect(within(dialog).getByText(/holds 2 entries/)).toBeTruthy();
    expect(within(dialog).getByText(/will not remove your writing/)).toBeTruthy();
  });

  it("shows the refusal instead of closing on it", async () => {
    // The commonest failure here is "this section still holds four entries",
    // which is something to act on rather than a dead end.
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") {
        return {
          ok: false,
          json: async () => ({ detail: { code: "type_invalid",
                                         message: "Bloodlines still holds 2 entries." } }),
        } as Response;
      }
      return { ok: true, json: async () => typoTree(2) } as Response;
    }));
    render(<WeaveNav projectPath={PROJECT} onOpenSection={vi.fn()} onOpenWeave={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("weave-nav")).toBeTruthy());
    await openGroup("Other");
    await userEvent.click(screen.getByRole("button", { name: "Bloodlines settings" }));
    const dialog = screen.getByRole("dialog", { name: "Bloodlines settings" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove it/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(within(dialog).getByText(/still holds 2 entries/)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Bloodlines settings" })).toBeTruthy();
  });

  it("promises a note is kept, and then says where it went", async () => {
    // A delete that silently keeps a copy is as dishonest as one that
    // silently does not.
    mockApi(typoTree());
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        calls.push({ url: String(input), method, body: {} });
        return { ok: true,
                 json: async () => ({ ...tree(), moved_to: "notes/trash/dungeon-rules.md" }),
               } as Response;
      }
      return { ok: true, json: async () => typoTree() } as Response;
    }));
    render(<WeaveNav projectPath={PROJECT} onOpenSection={vi.fn()} onOpenWeave={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("weave-nav")).toBeTruthy());
    await openGroup("Notes");
    await userEvent.click(screen.getByRole("button", { name: "Dungeon Rules settings" }));
    const dialog = screen.getByRole("dialog", { name: "Dungeon Rules settings" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Remove it/ }));
    expect(within(dialog).getByText(/moves to a trash folder/)).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(screen.getByText("notes/trash/dungeon-rules.md")).toBeTruthy());
    expect(calls[0].method).toBe("DELETE");
  });

  it("names the target in the query, not the body", async () => {
    // A DELETE carrying a body is the kind of thing a proxy quietly drops.
    const dialog = await openConfirm("Bloodlines", "Other");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toContain("id=bloodline");
    expect(calls[0].url).not.toContain("filename=");
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
