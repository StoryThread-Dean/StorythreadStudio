// AudiobookThemeSection.test.tsx -- the Converter's own Dark / Light / Custom
// ============================================================================
// Spec 5.0 fixed the Converter at charcoal in BOTH app themes, and the reason
// was sound: the writer should always know which side of the app they are
// standing in. It is now a choice instead, on the writer's ruling, and the
// spec is amended in the same change.
//
// What these pin is the part of that decision that would otherwise rot: the
// two sides stay INDEPENDENT. Coupling the Converter to the writing app's
// theme would make one switch silently restyle a feature the writer was not
// looking at, and would forbid a dark editor beside a paper Converter.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { AudiobookThemeSection, AUDIOBOOK_TARGET } from "./AudiobookThemeSection";
import { setAudiobookTheme, setAudiobookPalette, audiobookStyle } from "../theme/useAudiobookTheme";
import { APP_TARGET } from "../theme/CustomThemeEditor";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  // Module-level store: reset it, or a test that saved a palette leaves the
  // next one seeded from it. Learned the hard way in CustomThemeEditor.test.
  await setAudiobookPalette({});
  await setAudiobookTheme("dark");
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function saved(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("the three options", () => {
  it("offers charcoal, paper and custom, with charcoal the default", () => {
    render(<AudiobookThemeSection />);
    expect(screen.getByRole("button", { name: /Charcoal/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Paper/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Custom/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Charcoal/ }).getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("says the Converter keeps its own look, separate from the editor", () => {
    // The writer needs telling, or two theme switches read as a bug rather
    // than as a choice.
    render(<AudiobookThemeSection />);
    expect(screen.getByText(/separate from the writing side/)).toBeTruthy();
  });

  it("persists a switch to paper under its OWN settings key", async () => {
    render(<AudiobookThemeSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Paper/ }));
    });
    await waitFor(() => expect(saved().length).toBeGreaterThan(0));
    const body = saved()[0];
    expect(body.audiobook_theme).toBe("light");
    // NOT the writing app's key. Writing `theme` here would drag the editor
    // into light mode alongside it, which is the coupling this design
    // deliberately avoids.
    expect(body).not.toHaveProperty("theme");
  });
});

describe("opening the colour editor", () => {
  it("does not switch the theme first", async () => {
    // ORDER MATTERS, and getting it wrong is a real bug rather than a nicety:
    // switching to custom repaints from an empty palette, which is charcoal,
    // so a writer on Paper would find the editor seeded from charcoal instead
    // of from the theme they were actually looking at.
    render(<AudiobookThemeSection />);
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    expect(screen.getByTestId("custom-theme-editor")).toBeTruthy();
    expect(saved().some(b => b.audiobook_theme === "custom")).toBe(false);
  });

  it("names itself as the audiobook's palette, not the app's", () => {
    render(<AudiobookThemeSection />);
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    // Both editors are the same component; the header is how a writer knows
    // which palette they are about to change.
    expect(screen.getByText("Audiobook custom theme")).toBeTruthy();
  });

  it("offers a way back to charcoal, in the Converter's own words", () => {
    render(<AudiobookThemeSection />);
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    expect(screen.getByRole("button", { name: /Use Charcoal instead/ })).toBeTruthy();
  });
});

describe("one editor, two targets", () => {
  it("keeps the two targets genuinely separate", () => {
    // If these ever pointed at the same store, editing one palette would
    // silently rewrite the other.
    expect(AUDIOBOOK_TARGET.getStored).not.toBe(APP_TARGET.getStored);
    expect(AUDIOBOOK_TARGET.save).not.toBe(APP_TARGET.save);
    expect(AUDIOBOOK_TARGET.preview).not.toBe(APP_TARGET.preview);
    expect(AUDIOBOOK_TARGET.revert).not.toBe(APP_TARGET.revert);
  });

  it("gives each target its own wording", () => {
    expect(AUDIOBOOK_TARGET.title).not.toBe(APP_TARGET.title);
    expect(AUDIOBOOK_TARGET.shippedLabel).not.toBe(APP_TARGET.shippedLabel);
  });
});

describe("how a custom palette reaches the Converter", () => {
  it("produces an inline style, because the class would otherwise win", () => {
    // .audiobook-theme declares its own --st-* on a descendant of <html>, and
    // an element's own declaration beats an inherited one. That is what keeps
    // the Converter charcoal while the writing app goes light -- and it is
    // also why this palette cannot be applied on <html> like the app's is.
    const style = audiobookStyle("custom", { "--st-bg-panel": "#101010" }) as
      Record<string, string> | undefined;
    expect(style).toBeTruthy();
    expect(style!["--st-bg-panel"]).toBe("#101010");
  });

  it("carries color-scheme, derived from the window colour", () => {
    // Native scrollbars and <select> popups are drawn by the OS outside the
    // page; no custom property reaches them. A writer picking colours is not
    // thinking about scrollbars, so it is derived rather than asked.
    const light = audiobookStyle("custom", { "--st-bg-primary": "#F5F2EC" }) as
      Record<string, string>;
    const dark = audiobookStyle("custom", { "--st-bg-primary": "#09090b" }) as
      Record<string, string>;
    expect(light.colorScheme).toBe("light");
    expect(dark.colorScheme).toBe("dark");
  });

  it("applies nothing at all in the two shipped themes", () => {
    // Dark and paper come from App.css. An inline style here would sit on top
    // of the stylesheet and could not be removed by switching theme.
    expect(audiobookStyle("dark", { "--st-bg-panel": "#fff" })).toBeUndefined();
    expect(audiobookStyle("light", { "--st-bg-panel": "#fff" })).toBeUndefined();
  });
});
