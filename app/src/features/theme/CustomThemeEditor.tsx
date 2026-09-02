// features/theme/CustomThemeEditor.tsx -- assign your own colours
// ================================================================
// Two panels. Left is every role colour the app has, grouped and scrolling.
// Right is the wheel, pinned in place, working on whichever row is selected.
//
// WHY THE WHEEL APPLIES DIRECTLY INSTEAD OF HANDING OVER A HEX TO PASTE.
// The layout the writer sketched had the wheel produce a hex code they would
// copy and paste into the row on the left. That works, and it is two steps per
// colour across fifty-six colours. Selecting a row first and letting the wheel
// drive it is the same screen with the copy/paste removed -- and the hex is
// still shown, still selectable, so pasting it somewhere else is unaffected.
//
// PREVIEW IS LIVE, SAVING IS NOT, and that pairing is deliberate.
// "Manual save only" is a locked product rule, but nobody can pick fifty-six
// colours blind. So every keystroke repaints the app underneath this dialog
// while the FILE changes only on Save, and closing without saving repaints
// from what was stored. That is what makes Cancel mean something here.
//
// THE CONTRAST FIGURES ARE THE POINT, not a nicety. This whole line of work
// started with a writer who could not evaluate the app because its faint text
// failed WCAG AA. This screen is the one place a writer can reintroduce that
// for themselves, so the three ink rows carry their live ratio and say when it
// drops under 4.5. It warns rather than refuses -- it is their app.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Palette, RotateCcw, Save, AlertTriangle } from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Explain } from "../../components/learn/Explain";
import {
  THEME_TOKEN_GROUPS, type CustomTheme, type ThemeToken,
} from "./themeTokens";
import {
  parseColor, formatColor, toHex, contrast, AA_NORMAL, clampAlpha,
  type Rgba,
} from "./color";
import {
  getCustomTheme, readCurrentTokens, previewCustomTheme, revertPreview,
  setCustomTheme, setTheme,
} from "../../hooks/useTheme";
import { ColorWheel } from "./ColorWheel";


/**
 * Which palette this editor is editing.
 *
 * TWO TARGETS, ONE EDITOR. The Audiobook Converter needs the same screen for
 * its own palette, and a second copy of a 56-row colour grid would be the
 * clearest possible example of the drift this repo keeps finding. So the
 * differences are hoisted into this seam instead: everything visual, every
 * validation and the whole contrast readout stays shared.
 *
 * The two sides differ in exactly four things -- where a stored palette lives,
 * how a draft is previewed, what Save does, and what "back to the shipped
 * theme" means over there.
 */
export interface ThemeTarget {
  /** Shown in the dialog header and used as its accessible name. */
  title: string;
  /** Wording for the escape hatch back to a shipped theme. */
  shippedLabel: string;
  getStored: () => CustomTheme;
  preview: (palette: CustomTheme) => void;
  revert: () => void;
  save: (palette: CustomTheme) => Promise<void>;
  useShipped: () => void;
}


/** A colour that is always safe to hand a swatch or the wheel. */
const FALLBACK: Rgba = { r: 128, g: 128, b: 128, a: 1 };

function read(theme: CustomTheme, name: string): Rgba {
  return parseColor(theme[name] ?? "") ?? FALLBACK;
}


export function CustomThemeEditor({
  onClose,
  target = APP_TARGET,
}: {
  onClose: () => void;
  target?: ThemeTarget;
}) {
  // Where the live colours are READ from. For the writing app this resolves
  // against <html>; rendered inside the Converter it resolves against the
  // audiobook ramp, because that is where this element sits in the tree. One
  // mechanism, no per-target branch.
  const scopeRef = useRef<HTMLDivElement | null>(null);

  // Prefer a stored palette; otherwise seed from whatever is on screen, which
  // is the theme the writer was just looking at and a far better starting
  // point than an empty grid.
  const [draft, setDraft] = useState<CustomTheme>(() => target.getStored());
  // Seeding cannot happen in useState: the element does not exist yet, so
  // there is nothing to take computed values from. It happens once on mount
  // instead, and only when there is no stored palette to prefer.
  const [seeded, setSeeded] = useState(
    () => Object.keys(target.getStored()).length > 0,
  );

  useEffect(() => {
    if (seeded) return;
    const live = readCurrentTokens(scopeRef.current);
    if (Object.keys(live).length > 0) setDraft(live);
    setSeeded(true);
  }, [seeded]);
  const [selected, setSelected] = useState<string>("--st-bg-primary");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Paint the app from the draft on every change. The dependency is the draft
  // itself, so this also runs once on mount -- which is what shows the writer
  // their seeded palette in place rather than making them change something
  // before anything happens.
  useEffect(() => {
    if (!seeded) return;
    target.preview(draft);
  }, [draft, seeded, target]);

  // Leaving without saving must put back what was stored. Without this, a
  // writer who cancels keeps looking at a palette that is not in their
  // settings file and will vanish on restart -- the worst of both.
  useEffect(() => () => { target.revert(); }, [target]);

  const update = useCallback((name: string, value: string) => {
    setDraft(prev => ({ ...prev, [name]: value }));
    setDirty(true);
    setSaved(false);
  }, []);

  /** Write a colour back in the shape its token expects. */
  const setColor = useCallback((token: ThemeToken, next: Rgba) => {
    // Preserve the existing alpha for a translucent token: the wheel only
    // chooses hue, saturation and lightness, and silently flattening
    // --st-faint to opaque would break it on three of four surfaces.
    const existing = read(draft, token.name);
    const withAlpha = token.hasAlpha ? { ...next, a: existing.a } : next;
    update(token.name, formatColor(withAlpha, token.hasAlpha ? "rgba" : "hex"));
  }, [draft, update]);

  const selectedToken = useMemo(
    () => THEME_TOKEN_GROUPS.flatMap(g => g.tokens).find(t => t.name === selected),
    [selected],
  );

  /** How many ink rows are currently below the AA floor. */
  const failing = useMemo(() => {
    const out: string[] = [];
    for (const group of THEME_TOKEN_GROUPS) {
      for (const t of group.tokens) {
        if (!t.contrastAgainst) continue;
        const ratio = contrast(read(draft, t.name), read(draft, t.contrastAgainst));
        if (ratio < AA_NORMAL) out.push(t.label);
      }
    }
    return out;
  }, [draft]);

  const reseed = useCallback((from: "dark" | "light") => {
    // Read a shipped palette by briefly rendering it and snapshotting the
    // computed values. Reading the live stylesheet is what keeps this in step
    // with App.css rather than holding a second copy of 56 values.
    //
    // The attribute is flipped on whichever host this editor sits in, so the
    // same code seeds from the writing app's themes or the Converter's
    // depending on where it was opened.
    target.revert();
    const el = scopeRef.current;
    const host = el?.closest(".audiobook-theme") ?? document.documentElement;
    const attr = host === document.documentElement ? "data-theme" : "data-ab-theme";
    const had = host.getAttribute(attr);
    if (from === "light") host.setAttribute(attr, "light");
    else host.removeAttribute(attr);
    const snapshot = readCurrentTokens(el);
    if (had === null) host.removeAttribute(attr);
    else host.setAttribute(attr, had);
    if (Object.keys(snapshot).length > 0) setDraft(snapshot);
    setDirty(true);
    setSaved(false);
  }, [target]);

  const save = useCallback(async () => {
    await target.save(draft);
    setDirty(false);
    setSaved(true);
  }, [draft, target]);

  return (
    <Dialog
      label={target.title}
      testId="custom-theme-editor"
      size="xl"
      onClose={onClose}
      dirty={dirty}
      confirmMessage={
        "You have colour changes that are not saved. Closing puts your "
        + "previous theme back. Close anyway?"
      }
      title={
        <span className="flex items-center gap-2">
          <Palette size={14} className="text-accent" />
          {target.title}
          <Explain of="theme.custom" compact />
        </span>
      }
      footer={
        <div className="flex items-center gap-2">
          {failing.length > 0 && (
            <span
              data-testid="contrast-warning"
              className="flex items-center gap-1.5 text-mini text-warn-strong"
            >
              <AlertTriangle size={12} />
              {failing.length === 1
                ? `${failing[0]} is hard to read`
                : `${failing.length} text colours are hard to read`}
            </span>
          )}
          {saved && !dirty && (
            <span className="text-mini text-success">Saved.</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => { target.useShipped(); onClose(); }}
              className="rounded border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-danger-fill hover:text-text-primary"
              title="Go back to the shipped theme. Your saved colours are kept."
            >
              {target.shippedLabel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty}
              className="inline-flex items-center gap-1.5 rounded border border-accent-fill bg-accent-soft px-3 py-1 text-xs font-medium text-text-primary transition-colors hover:bg-bg-raised disabled:opacity-40"
            >
              <Save size={12} /> Save colours
            </button>
          </div>
        </div>
      }
    >
      <div ref={scopeRef} className="flex min-h-0 flex-1 gap-4">
        {/* -- LEFT: every colour, grouped, scrolling ------------------- */}
        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">Start again from:</span>
            <button
              type="button"
              onClick={() => reseed("dark")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:border-accent-fill hover:text-text-primary"
            >
              <RotateCcw size={10} /> Dark
            </button>
            <button
              type="button"
              onClick={() => reseed("light")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:border-accent-fill hover:text-text-primary"
            >
              <RotateCcw size={10} /> Light
            </button>
          </div>

          {THEME_TOKEN_GROUPS.map(group => (
            <section key={group.title} className="mb-5">
              <h3 className="text-sm font-semibold text-text-primary">
                {group.title}
              </h3>
              <p className="mb-2 text-xs text-faint">{group.blurb}</p>

              <div className="space-y-1">
                {group.tokens.map(token => {
                  const colour = read(draft, token.name);
                  const isSelected = selected === token.name;
                  const ratio = token.contrastAgainst
                    ? contrast(colour, read(draft, token.contrastAgainst))
                    : null;

                  return (
                    <div
                      key={token.name}
                      onClick={() => setSelected(token.name)}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 transition-colors ${
                        isSelected
                          ? "border-accent-fill bg-bg-surface"
                          : "border-transparent hover:bg-bg-raised"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-text-primary">
                          {token.label}
                        </div>
                        <code className="text-micro text-faint">{token.name}</code>
                      </div>

                      {ratio !== null && (
                        // The live figure, next to the colour that produces
                        // it. A warning in a corner somewhere would not tell
                        // the writer WHICH colour to move.
                        <span
                          className={`shrink-0 text-micro ${
                            ratio < AA_NORMAL ? "text-warn-strong" : "text-faint"
                          }`}
                          title={
                            ratio < AA_NORMAL
                              ? `${ratio.toFixed(2)} to 1 against the panel. Under 4.5 is hard to read at small sizes.`
                              : `${ratio.toFixed(2)} to 1 against the panel.`
                          }
                        >
                          {ratio.toFixed(1)}:1
                        </span>
                      )}

                      {/* The hex box. Typing is free-form and only applied
                          when it PARSES, so a half-typed "#12" leaves the
                          previous colour alone instead of repainting the app
                          from a guess. */}
                      <input
                        type="text"
                        aria-label={`${token.label} hex`}
                        value={toHex(colour)}
                        onChange={e => {
                          const parsed = parseColor(e.target.value);
                          if (parsed) setColor(token, parsed);
                        }}
                        className="w-24 shrink-0 rounded border border-border bg-bg-surface px-1.5 py-0.5 font-mono text-micro text-text-primary outline-none focus:border-accent-fill"
                      />

                      {token.hasAlpha && (
                        <label className="flex shrink-0 items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            aria-label={`${token.label} opacity percent`}
                            value={Math.round(colour.a * 100)}
                            onChange={e => {
                              const pct = Number(e.target.value);
                              if (!Number.isFinite(pct)) return;
                              update(
                                token.name,
                                formatColor({ ...colour, a: clampAlpha(pct / 100) }, "rgba"),
                              );
                            }}
                            className="w-14 rounded border border-border bg-bg-surface px-1 py-0.5 text-micro text-text-primary outline-none focus:border-accent-fill"
                          />
                          <span className="text-micro text-faint">%</span>
                        </label>
                      )}

                      {/* The OS picker, which is where the eyedropper lives.
                          A writer matching a colour off a screenshot needs it
                          and no wheel replaces it. */}
                      <input
                        type="color"
                        aria-label={`${token.label} colour picker`}
                        value={toHex(colour)}
                        onChange={e => {
                          const parsed = parseColor(e.target.value);
                          if (parsed) setColor(token, parsed);
                        }}
                        className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-bg-surface"
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* -- RIGHT: the wheel, pinned ---------------------------------- */}
        <aside className="w-64 shrink-0 self-start rounded border border-border bg-bg-surface p-3">
          <div className="mb-3">
            <div
              data-testid="selected-label"
              className="text-xs font-medium text-text-primary"
            >
              {selectedToken?.label ?? "Pick a colour"}
            </div>
            <code data-testid="selected-token" className="text-2xs text-faint">
              {selected}
            </code>
          </div>

          {selectedToken && (
            <ColorWheel
              /* Keyed on the token so the wheel does not carry a stale
                 hue across a change of selection. */
              key={selectedToken.name}
              value={read(draft, selectedToken.name)}
              onPick={next => setColor(selectedToken, next)}
            />
          )}

          <p className="mt-3 text-2xs text-faint">
            Click a row on the left to aim the wheel at it. The wheel sets hue
            and strength; the slider sets lightness. Transparency stays where
            you put it.
          </p>
        </aside>
      </div>
    </Dialog>
  );
}


/**
 * The writing app's palette, applied as inline properties on <html>.
 *
 * The default target, so every existing caller keeps working unchanged.
 */
export const APP_TARGET: ThemeTarget = {
  title: "Custom theme",
  shippedLabel: "Use Dark instead",
  getStored: getCustomTheme,
  preview: previewCustomTheme,
  revert: revertPreview,
  save: setCustomTheme,
  useShipped: () => { void setTheme("dark"); },
};
