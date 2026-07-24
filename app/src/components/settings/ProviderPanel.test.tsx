// ProviderPanel.test.tsx
// =======================
// The per-connection panel is meta-driven: whatever providerMeta.ts
// describes is what renders. These tests lock in the contract that matters
// for future providers -- tailored instructions per connection, the key
// field disappearing for keyless (local) providers, the "save to switch"
// hint, and the children slot that hosts provider-unique controls (the
// Prompt Caching toggle lives there for OpenRouter).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProviderPanel } from "./ProviderPanel";
import { PROVIDER_META, providerMetaById, type ProviderMeta } from "./providerMeta";

afterEach(() => {
  // globals: false means testing-library's auto-cleanup can't hook into
  // vitest's afterEach -- call cleanup() manually so each test starts with
  // a fresh DOM (same pattern as the other component tests).
  cleanup();
});

// Shared no-op wiring -- individual tests override what they assert on.
function panelProps(meta: ProviderMeta, overrides: Partial<Parameters<typeof ProviderPanel>[0]> = {}) {
  return {
    meta,
    isActive: true,
    savedKeyMasked: "",
    savedKeySet: false,
    keyInput: "",
    onKeyInputChange: vi.fn(),
    showKey: false,
    onToggleShowKey: vi.fn(),
    testing: false,
    saving: false,
    onTest: vi.fn(),
    testResult: null,
    ...overrides,
  };
}

describe("ProviderPanel", () => {
  it("renders the selected provider's own instructions", () => {
    const nano = providerMetaById("nanogpt");
    render(<ProviderPanel {...panelProps(nano)} />);
    expect(screen.getByText("How to connect to NanoGPT")).toBeTruthy();
    // A NanoGPT-specific step, not OpenRouter copy.
    expect(screen.getByText(/nano-gpt\.com and add funds/)).toBeTruthy();
    expect(screen.queryByText(/openrouter\.ai/)).toBeNull();
  });

  it("shows the provider-specific note (NanoGPT's missing pricing data)", () => {
    const nano = providerMetaById("nanogpt");
    render(<ProviderPanel {...panelProps(nano)} />);
    expect(screen.getByText(/does not publish pricing or moderation data/)).toBeTruthy();
  });

  it("hides the key field when the provider does not require a key", () => {
    // Future local providers (Ollama etc.) set requiresKey false -- the
    // panel must render without any key input or Test button.
    const keyless: ProviderMeta = {
      ...providerMetaById("openrouter"),
      id: "local-test",
      label: "Local Runtime",
      requiresKey: false,
    };
    render(<ProviderPanel {...panelProps(keyless)} />);
    expect(screen.queryByPlaceholderText(/sk-or/)).toBeNull();
    expect(screen.queryByText("Test")).toBeNull();
  });

  it("shows the save-to-switch hint only when the panel is not the active provider", () => {
    const nano = providerMetaById("nanogpt");
    const { rerender } = render(<ProviderPanel {...panelProps(nano, { isActive: false })} />);
    expect(screen.getByText(/Save to switch to NanoGPT/)).toBeTruthy();
    rerender(<ProviderPanel {...panelProps(nano, { isActive: true })} />);
    expect(screen.queryByText(/Save to switch/)).toBeNull();
  });

  it("renders children -- the slot provider-unique controls plug into", () => {
    const or = providerMetaById("openrouter");
    render(
      <ProviderPanel {...panelProps(or)}>
        <p>Prompt Caching toggle goes here</p>
      </ProviderPanel>
    );
    expect(screen.getByText("Prompt Caching toggle goes here")).toBeTruthy();
  });

  it("masked saved key is displayed, never a raw key", () => {
    const or = providerMetaById("openrouter");
    render(<ProviderPanel {...panelProps(or, { savedKeySet: true, savedKeyMasked: "sk-or-...mnop" })} />);
    expect(screen.getByText(/Current key: sk-or-\.\.\.mnop/)).toBeTruthy();
  });
});

describe("PROVIDER_META registry", () => {
  it("every entry has the fields the panel and cards depend on", () => {
    expect(PROVIDER_META.length).toBeGreaterThanOrEqual(2);
    for (const p of PROVIDER_META) {
      expect(p.id.trim()).not.toBe("");
      expect(p.label.trim()).not.toBe("");
      expect(p.tagline.trim()).not.toBe("");
      expect(p.instructions.length).toBeGreaterThan(0);
    }
  });

  it("only OpenRouter supports tiers and caching today", () => {
    expect(providerMetaById("openrouter").supportsTiers).toBe(true);
    expect(providerMetaById("openrouter").supportsCaching).toBe(true);
    expect(providerMetaById("nanogpt").supportsTiers).toBe(false);
    expect(providerMetaById("nanogpt").supportsCaching).toBe(false);
  });

  it("providerMetaById falls back to the first (default) provider", () => {
    expect(providerMetaById("unknown").id).toBe("openrouter");
  });
});
