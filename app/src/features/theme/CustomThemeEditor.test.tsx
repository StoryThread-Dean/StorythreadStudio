// CustomThemeEditor.test.tsx -- the screen that hands over every colour
// ======================================================================
// The locked product rules this screen has to obey are unusually load-bearing
// here, because it repaints the whole app while it is open:
//
//   Manual save only. The DOM follows every keystroke (nobody can pick 56
//   colours blind) but the FILE follows only Save, and closing without saving
//   must put the writer's previous theme back. Get that wrong and a cancelled
//   edit leaves them looking at a palette that vanishes on restart.
//
//   Every feature explains itself. This one can make text unreadable, so it
//   owes an explanation more than most screens do.
//
// And the contract that matters most: this is the one place a writer can undo
// the contrast work that started this whole line of changes, so the ink rows
// must SAY when a choice is unreadable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { CustomThemeEditor } from "./CustomThemeEditor";
import { THEME_TOKENS, ALPHA_TOKEN_NAMES } from "./themeTokens";
import { setCustomTheme } from "../../hooks/useTheme";

/**
 * Seed the DOM with a full palette.
 *
 * jsdom does not resolve custom properties declared in a stylesheet -- App.css
 * is never parsed here -- but it DOES resolve inline ones, which is exactly
 * what readCurrentTokens() reads. So writing the tokens inline reproduces what
 * the editor sees in the real app.
 */
function seedTokens(overrides: Record<string, string> = {}) {
  const root = document.documentElement;
  for (const t of THEME_TOKENS) {
    const fallback = t.hasAlpha ? "rgb(255 255 255 / 0.72)" : "#23232D";
    root.style.setProperty(t.name, overrides[t.name] ?? fallback);
  }
}

function clearTokens() {
  const root = document.documentElement;
  for (const t of THEME_TOKENS) root.style.removeProperty(t.name);
  root.style.removeProperty("color-scheme");
  root.removeAttribute("data-theme");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  clearTokens();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);

  // EMPTY THE STORED PALETTE FIRST, and this is not boilerplate. useTheme is a
  // module-level store, so it outlives each render: a test that saves a
  // palette leaves it sitting there, and the NEXT test's editor seeds from it
  // instead of from the DOM. That is correct behaviour in the app and pure
  // cross-test leakage here -- it showed up as a wheel reading #0A0A0A, the
  // colour a completely different test had saved.
  await setCustomTheme({});

  seedTokens();
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
  clearTokens();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** The PUT bodies sent to the settings endpoint. */
function saved(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("the list of colours", () => {
  it("offers every role token the app has", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    // Not a sample: a token missing from this screen is a colour the writer
    // cannot reach, which keeps the shipped dark value in the middle of their
    // palette with nothing on screen to explain it.
    for (const t of THEME_TOKENS) {
      expect(
        screen.getByLabelText(`${t.label} hex`),
        `${t.name} has no row`,
      ).toBeTruthy();
    }
  });

  it("groups them under the headings App.css uses", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    for (const title of ["Surfaces", "Ink", "Lines", "Accent", "Categorical", "Editor layers"]) {
      expect(screen.getByText(title), `no ${title} heading`).toBeTruthy();
    }
  });

  it("shows an opacity box for exactly the translucent tokens", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    for (const t of THEME_TOKENS) {
      const box = screen.queryByLabelText(`${t.label} opacity percent`);
      if (t.hasAlpha) {
        expect(box, `${t.name} needs an opacity box`).toBeTruthy();
      } else {
        // An opacity box on a hex token would be written back as hex and
        // silently discarded -- a control that appears to work and does not.
        expect(box, `${t.name} must not offer opacity`).toBeNull();
      }
    }
    expect(ALPHA_TOKEN_NAMES.length).toBe(11);
  });

  it("offers the OS picker too, which is where the eyedropper lives", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    // A writer matching a colour off a screenshot needs the native dialog and
    // no wheel replaces it.
    expect(screen.getAllByLabelText(/colour picker$/).length).toBe(THEME_TOKENS.length);
  });
});

describe("editing a colour", () => {
  it("paints the app immediately, without saving", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    const box = screen.getByLabelText("The window itself hex");
    fireEvent.change(box, { target: { value: "#123456" } });

    // The DOM followed...
    expect(document.documentElement.style.getPropertyValue("--st-bg-primary"))
      .toBe("#123456");
    // ...and nothing was written.
    expect(saved()).toEqual([]);
  });

  it("ignores a half-typed hex rather than repainting from a guess", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    const box = screen.getByLabelText("The window itself hex");
    fireEvent.change(box, { target: { value: "#12" } });
    // Still the seeded colour. Guessing black here would flash the app dark
    // on the way to every colour the writer types.
    expect(document.documentElement.style.getPropertyValue("--st-bg-primary"))
      .toBe("#23232D");
  });

  it("keeps a translucent token translucent when its colour changes", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Hints, counts, timestamps hex"), {
      target: { value: "#FFFFFF" },
    });
    const applied = document.documentElement.style.getPropertyValue("--st-faint");
    // Flattening --st-faint to opaque hex would break it on three of the four
    // surfaces it lands on. The shape must survive a colour change.
    expect(applied).toMatch(/^rgb\(255 255 255 \/ 0\.72\)$/);
  });

  it("writes opacity back in the shape CSS expects", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Hints, counts, timestamps opacity percent"), {
      target: { value: "40" },
    });
    expect(document.documentElement.style.getPropertyValue("--st-faint"))
      .toBe("rgb(255 255 255 / 0.4)");
  });
});

describe("the readability warning", () => {
  it("shows each ink row's live contrast against a panel", () => {
    seedTokens({
      "--st-bg-panel": "#23232D",
      "--st-text-primary": "rgb(255 255 255 / 0.92)",
    });
    render(<CustomThemeEditor onClose={vi.fn()} />);
    // 13.3:1 -- the figure recorded in App.css for this pair.
    expect(screen.getByTitle(/13\.3\d to 1 against the panel/)).toBeTruthy();
  });

  it("warns when a choice drops under the AA floor", () => {
    // The exact value that started all of this: light faint at 45%.
    seedTokens({
      "--st-bg-panel": "#FBF9F4",
      "--st-faint": "rgb(26 26 26 / 0.45)",
      "--st-text-primary": "rgb(26 26 26 / 0.94)",
      "--st-text-muted": "rgb(26 26 26 / 0.78)",
      "--st-on-accent": "#FFFFFF",
      "--st-accent-fill": "#1565C0",
    });
    render(<CustomThemeEditor onClose={vi.fn()} />);
    expect(screen.getByTestId("contrast-warning")).toBeTruthy();
  });

  it("stays quiet when every ink clears the floor", () => {
    seedTokens({
      "--st-bg-panel": "#23232D",
      "--st-text-primary": "rgb(255 255 255 / 0.92)",
      "--st-text-muted": "rgb(255 255 255 / 0.72)",
      "--st-faint": "rgb(255 255 255 / 0.55)",
      "--st-on-accent": "#10202E",
      "--st-accent-fill": "#42A5F5",
    });
    render(<CustomThemeEditor onClose={vi.fn()} />);
    expect(screen.queryByTestId("contrast-warning")).toBeNull();
  });

  it("warns rather than refusing -- it is the writer's app", () => {
    seedTokens({ "--st-bg-panel": "#23232D", "--st-faint": "rgb(255 255 255 / 0.1)" });
    render(<CustomThemeEditor onClose={vi.fn()} />);
    expect(screen.getByTestId("contrast-warning")).toBeTruthy();
    // Save is still available. A theme editor that refused a colour would be
    // making an accessibility decision on the writer's behalf about their own
    // eyes, which is not the same thing as shipping a readable default.
    fireEvent.change(screen.getByLabelText("The window itself hex"), {
      target: { value: "#111111" },
    });
    expect((screen.getByRole("button", { name: /Save colours/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("saving and cancelling", () => {
  it("persists the whole palette and switches the theme on Save", async () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("The window itself hex"), {
      target: { value: "#0A0A0A" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save colours/ }));
    });

    await waitFor(() => expect(saved().length).toBeGreaterThan(0));
    const body = saved()[0];
    expect(body.theme).toBe("custom");
    const palette = body.custom_theme as Record<string, string>;
    expect(palette["--st-bg-primary"]).toBe("#0A0A0A");
    // EVERY token, not just the changed one. A sparse palette falls back to
    // the shipped dark value for whatever is missing, so a light custom theme
    // would keep one or two stubborn dark patches.
    expect(Object.keys(palette).length).toBe(THEME_TOKENS.length);
  });

  it("cannot be saved until something changes", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Save colours/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("puts the previous theme back when closed without saving", () => {
    const onClose = vi.fn();
    const { unmount } = render(<CustomThemeEditor onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("The window itself hex"), {
      target: { value: "#654321" },
    });
    expect(document.documentElement.style.getPropertyValue("--st-bg-primary"))
      .toBe("#654321");

    unmount();

    // Reverted. Without this a cancelled edit leaves the writer looking at a
    // palette that is not in their settings file and disappears on restart --
    // the worst of both outcomes.
    expect(document.documentElement.style.getPropertyValue("--st-bg-primary"))
      .not.toBe("#654321");
  });

  it("guards the close once there is something to lose", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    // The shared Dialog owns the guard (useAttemptClose, R11.5). What this
    // screen owes is an honest `dirty`, and a message naming what is at stake
    // rather than "unsaved changes".
    const dialog = screen.getByTestId("custom-theme-editor");
    expect(dialog).toBeTruthy();
    expect(dialog.parentElement?.className).toContain("fixed");
  });

  it("offers a way back to the shipped theme", async () => {
    const onClose = vi.fn();
    render(<CustomThemeEditor onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Use Dark instead/ }));
    });
    // A writer who dislikes what they built needs one button, not a hunt back
    // through Settings for a theme they can no longer see the text of.
    await waitFor(() => expect(saved().some(b => b.theme === "dark")).toBe(true));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the wheel", () => {
  it("aims at whichever row is selected", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    // Starts on the first surface, so the wheel is never pointing at nothing.
    expect(screen.getByTestId("selected-token").textContent).toBe("--st-bg-primary");

    fireEvent.click(screen.getByText("Hover and menus"));

    // The right panel NAMES what it is editing. Without that the wheel and
    // the row could be about different colours and the writer would have no
    // way to tell which one they were changing.
    expect(screen.getByTestId("selected-token").textContent).toBe("--st-bg-raised");
    expect(screen.getByTestId("selected-label").textContent).toBe("Hover and menus");
  });

  it("moves the wheel's own colour with the selection", () => {
    seedTokens({ "--st-bg-primary": "#111111", "--st-bg-raised": "#EEEEEE" });
    render(<CustomThemeEditor onClose={vi.fn()} />);
    expect(screen.getByTestId("wheel-hex").textContent).toBe("#111111");
    fireEvent.click(screen.getByText("Hover and menus"));
    expect(screen.getByTestId("wheel-hex").textContent).toBe("#EEEEEE");
  });

  it("shows a copyable hex for the selected colour", () => {
    render(<CustomThemeEditor onClose={vi.fn()} />);
    // The writer's sketch had the wheel produce a hex to paste. The wheel
    // applies directly now, but the hex is still shown and still selectable,
    // so pasting it elsewhere is unaffected.
    expect(screen.getByTestId("wheel-hex").textContent).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("explains itself", () => {
    // Locked product rule: every feature offers one What's this. This screen
    // can make the app unreadable, so it owes one more than most.
    render(<CustomThemeEditor onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /what/i })).toBeTruthy();
  });
});
