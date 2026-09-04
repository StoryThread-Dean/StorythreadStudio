// ProjectHome.test.tsx
// ====================
// The dashboard's Recent Projects column, and one rule above all others:
// "I could not read your projects" must never render as "you have no
// projects". Those were the same state here for a long time.
//
// The bug this file pins: the column fetched once on mount, and every failure
// path -- a rejected fetch, a non-2xx, a malformed body -- collapsed into
// setRecentProjects([]), which renders "No recent projects yet." On a cold
// start the backend has not bound its port yet, so a writer with six books
// was told they had none, and nothing retried. The global backend-down banner
// is deliberately suppressed in that same window (it waits for one successful
// ping to avoid a startup flash), so there was no warning anywhere on screen.
//
// Note on queries: a book title can appear TWICE on this screen -- once on the
// "Continue where you left off" hero and once in the list -- so presence is
// asserted with findAllByText. An earlier draft of this file used findByText
// and failed on the ambiguity, which is a reminder that the hero is built from
// this same fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// The Tauri dialog plugin only exists inside the shell -- mock it so the
// screen renders in jsdom. Must sit above the component import.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { ProjectHome } from "./ProjectHome";
import type { RecentProject } from "../types/project";

const RECENTS: RecentProject[] = [
  {
    project_id: "p1", title: "Becoming a Hero",
    root_path: "C:\\Storythread Studio\\Becoming a Hero",
    content_mode: "general", series_name: null, story_type: "novel",
    last_opened: "2026-09-02T12:00:00Z", exists: true,
  },
  {
    project_id: "p2", title: "Members Only",
    root_path: "C:\\Storythread Studio\\members-only",
    content_mode: "general", series_name: null, story_type: "novel",
    last_opened: "2026-09-01T12:00:00Z", exists: true,
  },
];

const NOOP = { onProjectOpen: vi.fn(), onOpenAudiobooks: vi.fn() };

/**
 * ProjectHome fires TWO fetches on mount -- the recents list and /api/settings
 * for the vault root. The settings one must succeed or it lands in its own
 * (genuinely harmless) catch and muddies the test.
 */
function mockFetch(recentsResponder: () => unknown) {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/projects/recent")) return recentsResponder();
    if (url.includes("/api/settings")) {
      return { ok: true, json: async () => ({ vault_root: "C:\\Storythread Studio" }) };
    }
    if (url.includes("/api/series/list")) return { ok: true, json: async () => ({ series: [] }) };
    return { ok: true, json: async () => ({}) };
  });
}

const ok = () => ({ ok: true, json: async () => RECENTS });

/** A port that is not bound yet -- what a cold start really produces. */
const unreachable = () => { throw new TypeError("Failed to fetch"); };

/** Let queued promises settle without leaning on real elapsed time. */
const settle = () => act(async () => { await Promise.resolve(); });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});


describe("Recent Projects -- the ordinary path", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(ok));
  });

  it("lists the writer's projects", async () => {
    render(<ProjectHome {...NOOP} />);
    expect((await screen.findAllByText("Becoming a Hero")).length).toBeGreaterThan(0);
    expect(screen.getByText("Members Only")).toBeTruthy();
  });

  it("offers the most recent book on the hero", async () => {
    render(<ProjectHome {...NOOP} />);
    expect(await screen.findByTestId("hero-continue")).toBeTruthy();
  });
});


describe("Recent Projects -- a genuinely empty list", () => {
  it("says there are none yet, which is the one time that wording is true", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: true, json: async () => [] })));
    render(<ProjectHome {...NOOP} />);

    expect(await screen.findByText(/No recent projects yet/)).toBeTruthy();
    // Nothing to continue, so no hero -- a first run opens on the picker.
    expect(screen.queryByTestId("hero-continue")).toBeNull();
  });
});


describe("Recent Projects -- an unreachable backend is not an empty list", () => {
  it("waits, says so, and never claims there are no projects", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch(unreachable));

    render(<ProjectHome {...NOOP} />);

    // Mid-poll: it admits it is still trying, and the empty wording -- the
    // thing the writer actually saw -- is nowhere on screen.
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByText(/Connecting to your library/)).toBeTruthy();
    expect(screen.queryByText(/No recent projects yet/)).toBeNull();

    // Past the give-up window it escalates to something actionable.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Couldn't load your projects/)).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();

    // THE REGRESSION -- still not claiming an empty library.
    expect(screen.queryByText(/No recent projects yet/)).toBeNull();
    // And no hero, rather than a hero implying this is a first run.
    expect(screen.queryByTestId("hero-continue")).toBeNull();
  });

  it("fills in on its own once the backend binds, with no click", async () => {
    // The actual bug: the writer has no way to know a refresh is what they
    // need, so the screen has to recover by itself.
    vi.useFakeTimers();
    let bound = false;
    vi.stubGlobal("fetch", mockFetch(() => (bound ? ok() : unreachable())));

    render(<ProjectHome {...NOOP} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByText(/Connecting to your library/)).toBeTruthy();

    bound = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(screen.getAllByText("Becoming a Hero").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Connecting to your library/)).toBeNull();
  });
});


describe("Recent Projects -- the backend answered with an error", () => {
  it("passes on its reason, so a corrupt file reads differently from a dead service", async () => {
    // The unrecoverable-corruption case: the store raises rather than
    // answering [], and the route hands the detail on. A writer whose file is
    // damaged must not be told the service is merely slow.
    vi.stubGlobal("fetch", mockFetch(() => ({
      ok: false,
      json: async () => ({
        detail: "storythread.json could not be read, and neither could storythread.json.bak.",
      }),
    })));

    render(<ProjectHome {...NOOP} />);

    expect(await screen.findByText(/neither could storythread.json.bak/)).toBeTruthy();
    expect(screen.queryByText(/No recent projects yet/)).toBeNull();
  });

  it("answers immediately rather than waiting out the cold-start window", async () => {
    // An HTTP error means the backend is up and has already given its answer.
    // Retrying that for ten seconds would only make the writer wait to be
    // told something we already know.
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: false, json: async () => ({}) })));

    render(<ProjectHome {...NOOP} />);
    await settle();
    await settle();

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("recovers when the writer retries", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", mockFetch(() => {
      attempt += 1;
      return attempt === 1 ? { ok: false, json: async () => ({}) } : ok();
    }));

    render(<ProjectHome {...NOOP} />);

    fireEvent.click(await screen.findByText("Try again"));

    expect((await screen.findAllByText("Becoming a Hero")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
