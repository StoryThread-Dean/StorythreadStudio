// features/codex/EntryTools.test.tsx
// ==================================
// The reported case, kept whole:
//
//     "Pathicus was wrongly assumed to be a Character instead of a Deity. I
//      need to be able to change it from there or delete it altogether
//      because it was made incorrectly. This should reset the name connection
//      allowing for Dress the Loom to pick it up again."

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EntryTools } from "./EntryTools";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";
const PATHICUS = {
  entity_id: "e-pathicus", type: "character", name: "Pathicus",
  display_name: "", aliases: [], placeholder: false,
};

let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(options: { warnings?: string[]; fail?: string } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (options.fail) {
      return { ok: false, json: async () => ({
        detail: { code: "type_invalid", message: options.fail } }) } as Response;
    }
    return { ok: true, json: async () => ({
      entity_id: "e-pathicus", type: "deity",
      warnings: options.warnings ?? [], deleted: "e-pathicus", forgotten: 2,
    }) } as Response;
  }));
}

beforeEach(() => mockApi());

function open() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const onDeleted = vi.fn();
  render(<EntryTools projectPath={PROJECT} entry={PATHICUS}
                     onClose={onClose} onChanged={onChanged}
                     onDeleted={onDeleted} />);
  return { onClose, onChanged, onDeleted };
}

const sent = (fragment: string, method: string) =>
  calls.filter(c => c.url.includes(fragment) && c.method === method);


describe("it is the wrong kind of thing", () => {
  it("changes the kind, keeping the entry", async () => {
    const { onChanged } = open();
    await userEvent.selectOptions(
      screen.getByLabelText("What kind of thing"), "deity");
    await userEvent.click(screen.getByRole("button", { name: /Change it/ }));
    await waitFor(() => expect(sent("/entity/kind", "PATCH").length).toBe(1));
    expect(sent("/entity/kind", "PATCH")[0].body).toMatchObject({
      entity_id: "e-pathicus", type: "deity",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("says what survived, because that is the reason not to delete", async () => {
    open();
    await userEvent.selectOptions(
      screen.getByLabelText("What kind of thing"), "deity");
    await userEvent.click(screen.getByRole("button", { name: /Change it/ }));
    expect(await screen.findByText(/is a Deity now/)).toBeTruthy();
    expect(screen.getByText(/Everything written in it came with it/)).toBeTruthy();
  });

  it("reports a connection that no longer fits, without removing it", async () => {
    // Correcting a mistake must not delete the writer's work as a side
    // effect -- that would be a second, larger mistake made for them.
    mockApi({ warnings: ["'member of' is not something a deity usually does. "
                         + "The connection is kept."] });
    open();
    await userEvent.selectOptions(
      screen.getByLabelText("What kind of thing"), "deity");
    await userEvent.click(screen.getByRole("button", { name: /Change it/ }));
    expect(await screen.findByText(/is not something a deity usually does/))
      .toBeTruthy();
    expect(screen.getByText(/connection is kept/)).toBeTruthy();
  });

  it("cannot be pressed when nothing was picked", async () => {
    open();
    expect(screen.getByRole("button", { name: /Change it/ })
      .hasAttribute("disabled")).toBe(true);
  });

  it("keeps the writer here when the change is refused", async () => {
    mockApi({ fail: "There is no 'spaceship' in this world's kinds." });
    const { onChanged } = open();
    await userEvent.selectOptions(
      screen.getByLabelText("What kind of thing"), "deity");
    await userEvent.click(screen.getByRole("button", { name: /Change it/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});


describe("it should not be here at all", () => {
  it("asks twice, and the second time says what is lost", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: /Remove this entry/ }));
    expect(screen.getByText(/Everything written in this entry is deleted/))
      .toBeTruthy();
    expect(screen.getByText(/connections to other entries go with it/))
      .toBeTruthy();
    expect(sent("/entity", "DELETE")).toEqual([]);      // nothing yet
  });

  it("promises the manuscript is untouched and the name comes back", async () => {
    // The reported requirement, in the writer's own terms.
    open();
    await userEvent.click(screen.getByRole("button", { name: /Remove this entry/ }));
    expect(screen.getByText(/manuscript is not touched/)).toBeTruthy();
    expect(screen.getByText(/ask about it again/)).toBeTruthy();
  });

  it("deletes on the second press, and forgets the answers", async () => {
    const { onDeleted } = open();
    await userEvent.click(screen.getByRole("button", { name: /Remove this entry/ }));
    await userEvent.click(screen.getByRole("button", { name: /Yes, remove it/ }));
    await waitFor(() => expect(sent("/entity", "DELETE").length).toBe(1));
    expect(sent("/entity", "DELETE")[0].url).toMatch(/forget_answers=true/);
    expect(onDeleted).toHaveBeenCalled();
  });

  it("can be backed out of", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: /Remove this entry/ }));
    await userEvent.click(screen.getByRole("button", { name: /Keep it/ }));
    expect(screen.getByRole("button", { name: /Remove this entry/ })).toBeTruthy();
    expect(sent("/entity", "DELETE")).toEqual([]);
  });
});


describe("it explains itself", () => {
  it("offers one What's this, per the product rule", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: /what's this/i }));
    expect(screen.getByText(/most names in prose are people/)).toBeTruthy();
  });
});
