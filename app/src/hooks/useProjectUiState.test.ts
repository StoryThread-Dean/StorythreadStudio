// useProjectUiState.test.ts
// ==========================
// Hook tests for the per-book remembered UI state.
//
// What matters here (and what these tests pin):
//   1. GET happens on mount / project change, and its result hydrates state.
//   2. No PUT ever fires before the initial GET resolves -- otherwise a
//      toggle during startup would overwrite the saved layout with defaults.
//   3. Rapid update() calls coalesce into ONE debounced PUT.
//   4. Switching projects resets state and refetches.
//
// We drive the debounce with vi.useFakeTimers() and stub fetch globally.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjectUiState } from "./useProjectUiState";

type FetchCall = { url: string; method: string; body: unknown };

// Records every fetch; GETs resolve with `savedState`, PUTs with ok.
function stubFetch(savedState: Record<string, unknown> = {}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(
    (url: unknown, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      if (method === "GET") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ state: savedState }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok" }) });
    }
  ));
  return calls;
}

const puts = (calls: FetchCall[]) => calls.filter(c => c.method === "PUT");

describe("useProjectUiState", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches saved state on mount and hydrates", async () => {
    const calls = stubFetch({ profilesCollapsed: true });
    const { result } = renderHook(() => useProjectUiState("/fake/book"));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.uiState.profilesCollapsed).toBe(true);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("ui-state");
    expect(calls[0].url).toContain(encodeURIComponent("/fake/book"));
  });

  it("null projectPath fetches nothing", () => {
    const calls = stubFetch();
    renderHook(() => useProjectUiState(null));
    expect(calls.length).toBe(0);
  });

  it("debounces rapid updates into a single PUT with the merged state", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useProjectUiState("/fake/book"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => { result.current.update({ profilesCollapsed: true }); });
    act(() => { result.current.update({ notesCollapsed: true }); });
    act(() => { result.current.update({ profilesCollapsed: false }); });

    // Nothing written yet -- we're inside the debounce window.
    expect(puts(calls).length).toBe(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    const writes = puts(calls);
    expect(writes.length).toBe(1);
    expect(writes[0].body).toEqual({
      root_path: "/fake/book",
      state: { profilesCollapsed: false, notesCollapsed: true },
    });
  });

  it("never PUTs before the initial GET resolves", async () => {
    // A GET that never resolves simulates a slow backend at startup.
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(
      (url: unknown, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? "GET";
        calls.push({ url: String(url), method, body: undefined });
        return new Promise(() => undefined);   // hangs forever
      }
    ));

    const { result } = renderHook(() => useProjectUiState("/fake/book"));
    act(() => { result.current.update({ profilesCollapsed: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(puts(calls).length).toBe(0);
  });

  it("resets and refetches when the project changes", async () => {
    const calls = stubFetch({ profilesCollapsed: true });
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useProjectUiState(path),
      { initialProps: { path: "/book-a" as string | null } }
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.uiState.profilesCollapsed).toBe(true);

    rerender({ path: "/book-b" });
    // State resets immediately (no flash of book A's layout on book B).
    expect(result.current.uiState).toEqual({});

    await waitFor(() => expect(result.current.loaded).toBe(true));
    const gets = calls.filter(c => c.method === "GET");
    expect(gets.length).toBe(2);
    expect(gets[1].url).toContain(encodeURIComponent("/book-b"));
  });
});
