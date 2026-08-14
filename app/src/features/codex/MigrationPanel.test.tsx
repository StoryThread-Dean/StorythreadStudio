// features/codex/MigrationPanel.test.tsx
// ======================================
// The most dangerous button in the programme: it reads the writer's profile
// files and writes a new folder from them. So the tests here are about
// CONSENT rather than about mechanics -- the mechanics are covered by
// test_codex_migration.py, which owns dry-run-writes-nothing, idempotency,
// the success marker and resume-or-restore.
//
// What only this screen can get wrong is asking for permission it did not
// really obtain.

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MigrationPanel } from "./MigrationPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    state: "none",
    backup_path: "C:/MyNovel/profiles.backup-2026-08-10",
    convert: [
      { folder: "characters", type: "character", count: 12,
        files: ["elara.md"] },
      { folder: "locations", type: "location", count: 3, files: [] },
    ],
    arcs: [{ type: "characters", count: 2, files: [] }],
    skipped: [{ folder: "chapters", count: 4,
                reason: "Summaries live under summaries/ since v1.0.x." }],
    unconvertible: [{ folder: "sketches",
                      reason: "Not a profile type this version knows." }],
    warnings: ["characters/mira.md has no profile_id; it will be given a new id."],
    total: 15,
    ...overrides,
  };
}

let calls: { url: string }[] = [];

function mockApi(options: { plan?: Record<string, unknown>;
                            result?: Record<string, unknown>;
                            fail?: boolean } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    if (url.includes("dry_run=true")) {
      return { ok: true, json: async () => options.plan ?? plan() } as Response;
    }
    if (options.fail) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "source_corrupt",
                                       message: "A profile could not be read." } }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => options.result ?? {
        status: "migrated", converted: 15, arcs_absorbed: 2,
        backup_path: "C:/MyNovel/profiles.backup-2026-08-10",
        warnings: ["characters/mira.md was given a new id."],
        unconvertible: [],
      },
    } as Response;
  }));
}

beforeEach(() => mockApi());

async function open(props: Record<string, unknown> = {}) {
  const onChanged = vi.fn();
  render(<MigrationPanel projectPath={PROJECT} state="none"
                         onChanged={onChanged} {...props} />);
  await waitFor(() => expect(screen.getByTestId("migration-preview")).toBeTruthy());
  return { onChanged };
}

const writes = () => calls.filter(c => c.url.includes("dry_run=false")
                                    || c.url.includes("/restore"));


describe("the dry run is not optional", () => {
  it("previews before offering anything, and writes nothing to do it", async () => {
    await open();
    expect(calls.some(c => c.url.includes("dry_run=true"))).toBe(true);
    expect(writes()).toEqual([]);
  });

  it("sends dry_run explicitly rather than relying on the default", async () => {
    // The server defaults to the preview too. A client that forgot the
    // parameter must not be the reason a project gets rewritten.
    await open();
    expect(calls[0].url).toContain("dry_run=true");
  });
});


describe("what consent needs to include", () => {
  it("itemises the folders rather than quoting one number", async () => {
    // "Convert 15 files" is not consent.
    await open();
    expect(screen.getByText(/profiles\/characters\//)).toBeTruthy();
    expect(screen.getByText(/profiles\/locations\//)).toBeTruthy();
  });

  it("says what is being left alone, and why", async () => {
    await open();
    expect(screen.getByText(/Summaries live under summaries/)).toBeTruthy();
  });

  it("says what it cannot convert at all", async () => {
    // The thing a writer would otherwise discover missing afterwards.
    await open();
    expect(screen.getByText(/Not a profile type this version knows/)).toBeTruthy();
  });

  it("shows warnings before the button, not after the act", async () => {
    await open();
    expect(screen.getByText(/no profile_id/)).toBeTruthy();
  });

  it("names the backup folder before anything happens", async () => {
    // So the writer can go and look at it with their own file manager while
    // they decide.
    await open();
    expect(screen.getAllByText(/profiles.backup-2026-08-10/).length)
      .toBeGreaterThan(0);
  });

  it("promises the original folder is left in place", async () => {
    await open();
    expect(screen.getByText(/folder is left in place too/)).toBeTruthy();
  });
});


describe("the two clicks", () => {
  it("does not convert on the first click", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Convert 15 entries/ }));
    expect(writes()).toEqual([]);
  });

  it("repeats the count and the destination in the confirmation", async () => {
    // A confirmation that says only "are you sure?" adds a click and no
    // information.
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Convert 15 entries/ }));
    expect(screen.getByText(/Convert 15 entries, keeping a copy in/)).toBeTruthy();
  });

  it("converts on the second", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Convert 15 entries/ }));
    await userEvent.click(screen.getByRole("button", { name: /Yes, convert/ }));
    await waitFor(() => expect(writes().length).toBe(1));
    expect(writes()[0].url).toContain("dry_run=false");
  });

  it("lets the writer back out with nothing written", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Convert 15 entries/ }));
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    expect(writes()).toEqual([]);
    expect(screen.getByRole("button", { name: /Convert 15 entries/ })).toBeTruthy();
  });

  it("offers nothing to press when there is nothing to convert", async () => {
    mockApi({ plan: plan({ convert: [], arcs: [], total: 0 }) });
    await open();
    expect(screen.getByText(/no profiles yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Convert/ }).hasAttribute("disabled"))
      .toBe(true);
  });
});


describe("afterwards", () => {
  async function convert() {
    const handles = await open();
    await userEvent.click(screen.getByRole("button", { name: /Convert 15 entries/ }));
    await userEvent.click(screen.getByRole("button", { name: /Yes, convert/ }));
    await waitFor(() => expect(screen.getByTestId("migration-report")).toBeTruthy());
    return handles;
  }

  it("reports what was actually converted", async () => {
    await convert();
    expect(screen.getByText(/15 entries are now in the Weave/)).toBeTruthy();
  });

  it("hands off to the itemised results rather than summing it up", async () => {
    // The wording of what a conversion did belongs to MigrationResults, which
    // owns those assertions. What THIS screen is responsible for is handing
    // over to it instead of reporting a number and stopping.
    await convert();
    expect(screen.getByTestId("migration-results")).toBeTruthy();
    expect(screen.getByText(/profiles.backup-2026-08-10/)).toBeTruthy();
  });

  it("repeats the warnings rather than dropping them once it is done", async () => {
    // A conversion that quietly dropped something the preview mentioned would
    // be the worst outcome here.
    await convert();
    expect(screen.getByText(/was given a new id/)).toBeTruthy();
  });

  it("tells the screen around it to re-read the world", async () => {
    const { onChanged } = await convert();
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps the failure on screen instead of claiming success", async () => {
    mockApi({ fail: true });
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Convert 15 entries/ }));
    await userEvent.click(screen.getByRole("button", { name: /Yes, convert/ }));
    await waitFor(() =>
      expect(screen.getByText(/A profile could not be read/)).toBeTruthy());
    expect(screen.queryByTestId("migration-report")).toBeNull();
  });
});


describe("a run that did not finish", () => {
  async function interrupted() {
    mockApi();
    const onChanged = vi.fn();
    render(<MigrationPanel projectPath={PROJECT} state="incomplete"
                           onChanged={onChanged} />);
    await waitFor(() =>
      expect(screen.getByTestId("migration-interrupted")).toBeTruthy());
    return { onChanged };
  }

  it("offers resume or restore, and never guesses", async () => {
    // Success is never inferred from the codex folder existing -- a
    // half-finished conversion produces that too.
    await interrupted();
    expect(screen.getByRole("button", { name: /Carry on from where it stopped/ }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: /Put it back the way it was/ }))
      .toBeTruthy();
  });

  it("does not offer to convert again", async () => {
    await interrupted();
    expect(screen.queryByRole("button", { name: /^Convert/ })).toBeNull();
  });

  it("says nothing has been lost, and where the copy is", async () => {
    await interrupted();
    expect(screen.getByText(/Nothing has been lost/)).toBeTruthy();
    expect(screen.getByText(/profiles.backup-2026-08-10/)).toBeTruthy();
  });

  it("resumes rather than starting over", async () => {
    await interrupted();
    await userEvent.click(
      screen.getByRole("button", { name: /Carry on from where it stopped/ }));
    await waitFor(() => expect(writes().length).toBe(1));
    expect(writes()[0].url).toContain("resume=true");
  });

  it("restores through the endpoint built for it", async () => {
    mockApi({ result: { status: "restored",
                        backup_path: "C:/MyNovel/profiles.backup-2026-08-10" } });
    const onChanged = vi.fn();
    render(<MigrationPanel projectPath={PROJECT} state="incomplete"
                           onChanged={onChanged} />);
    await waitFor(() =>
      expect(screen.getByTestId("migration-interrupted")).toBeTruthy());
    await userEvent.click(
      screen.getByRole("button", { name: /Put it back the way it was/ }));
    await waitFor(() =>
      expect(screen.getByText(/back the way they were/)).toBeTruthy());
    expect(writes()[0].url).toContain("/restore");
  });
});
