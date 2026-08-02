// SpeakerWalkthrough.test.tsx
// ============================
// The cast walk. Two failures shaped this component and are pinned here:
//
//   IT MUST WORK WITH NO AI. The first build called a model before it
//   could show anything, and hung for fifteen minutes on one chapter
//   with no way out. The walk now opens instantly from a local scan; the
//   AI is an optional button, cancellable, with a timeout.
//
//   ONE-OFF SPEAKERS ARE THE COMMON CASE. A store clerk with a single
//   line should never be cast, so "Keep narrator" is a first-class
//   answer sitting beside the cast, not a skip hidden somewhere.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { SpeakerWalkthrough } from "./SpeakerWalkthrough";

const CONTENT =
  'The gate stood open.\n\n'
  + '"This cannot continue," Elena said.\n\n'
  + '"It already has."\n';

function renderWalk(over: Record<string, unknown> = {}) {
  const onAssign = vi.fn();
  const onAddToCast = vi.fn();
  const onClose = vi.fn();
  render(
    <SpeakerWalkthrough
      content={CONTENT}
      workspacePath="C:/books/ws"
      castNames={["Elena", "Marcus"]}
      onAssign={onAssign}
      onHighlight={vi.fn()}
      onAddToCast={onAddToCast}
      onClose={onClose}
      {...over}
    />,
  );
  return { onAssign, onAddToCast, onClose };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpeakerWalkthrough", () => {
  it("opens with the dialogue already found -- no network call", () => {
    // The whole point. If this ever needs fetch to render, the hang is
    // back.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWalk();
    expect(screen.getByText(/line 1 of 2/)).toBeTruthy();
    expect(screen.getByText('"This cannot continue,"')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the name the writer's own tag gives", () => {
    renderWalk();
    expect(screen.getByText(/your text says "Elena"/)).toBeTruthy();
  });

  it("assigns from a one-click cast button", () => {
    const { onAssign } = renderWalk();
    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0][0].quote).toBe('"This cannot continue,"');
    expect(onAssign.mock.calls[0][1]).toBe("Elena");
    // And the walk moves on by itself.
    expect(screen.getByText(/line 2 of 2/)).toBeTruthy();
  });

  it("Keep narrator advances without assigning -- the store-clerk case", () => {
    const { onAssign, onAddToCast } = renderWalk();
    fireEvent.click(screen.getByRole("button", { name: /Keep narrator/ }));
    expect(onAssign).not.toHaveBeenCalled();
    expect(onAddToCast).not.toHaveBeenCalled();
    expect(screen.getByText(/line 2 of 2/)).toBeTruthy();
  });

  it("a typed name that is not cast yet gets added to the cast", () => {
    // Otherwise the marker would reference a name the cast does not
    // know, and the line would quietly read as the narrator.
    const { onAssign, onAddToCast } = renderWalk();
    fireEvent.change(screen.getByLabelText("Speaker name"),
                     { target: { value: "Innkeeper" } });
    fireEvent.click(screen.getByRole("button", { name: /Assign/ }));
    expect(onAssign.mock.calls[0][1]).toBe("Innkeeper");
    expect(onAddToCast).toHaveBeenCalledWith("Innkeeper");
  });

  it("a name already in the cast is not re-added", () => {
    const { onAddToCast } = renderWalk();
    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    expect(onAddToCast).not.toHaveBeenCalled();
  });

  it("offers the AI only for the lines the prose did not tag", () => {
    renderWalk();
    expect(screen.getByRole("button", { name: /Ask AI about 1 untagged line/ }))
      .toBeTruthy();
  });

  it("the AI pass can be cancelled while it runs", async () => {
    // The fix for the fifteen-minute spinner: a request that never
    // answers must still give the writer their walk back.
    let abortSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      abortSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")));
      });
    }));

    renderWalk();
    fireEvent.click(screen.getByRole("button", { name: /Ask AI about/ }));
    await waitFor(() => expect(screen.getByText(/Asking the AI who speaks/)).toBeTruthy());
    expect(abortSignal).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText(/Stopped\./)).toBeTruthy());
    // And the walk is still usable.
    expect(screen.getByRole("button", { name: "Elena" })).toBeTruthy();
  });

  it("a failed AI pass says so and leaves the walk working", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 504,
      json: async () => ({ detail: "The model did not answer in time." }),
    })));
    renderWalk();
    fireEvent.click(screen.getByRole("button", { name: /Ask AI about/ }));
    await waitFor(() =>
      expect(screen.getByText(/did not answer in time/)).toBeTruthy());
    expect(screen.getByText(/The walk below still works/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Elena" })).toBeTruthy();
  });

  it("never sends the whole book to the AI", async () => {
    // A novel is past what the endpoint accepts, and asking a model to
    // read 300 pages to name a dozen speakers is how this looked broken.
    const long = CONTENT + "\n\n" + "Filler prose. ".repeat(4000);
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)).text;
      return { ok: true, json: async () => ({ proposals: [], dropped: 0 }) };
    }));
    renderWalk({ content: long });
    fireEvent.click(screen.getByRole("button", { name: /Ask AI about/ }));
    await waitFor(() => expect(sent).not.toBe(""));
    expect(sent.length).toBeLessThanOrEqual(24_000);
    expect(long.length).toBeGreaterThan(24_000);
  });

  it("says nothing is saved until Save", () => {
    renderWalk();
    expect(screen.getByText(/Nothing is saved until you\s+press Save/)).toBeTruthy();
  });

  it("reports an empty scan plainly instead of looking broken", () => {
    renderWalk({ content: "No dialogue here at all, just narration." });
    expect(screen.getByText(/no unassigned dialogue found here/)).toBeTruthy();
  });
});
