// components/settings/TextSizeControls.tsx -- the two size controls, once
// ========================================================================
// Interface size and Editor text size, as ONE component rendered in two
// places: the Settings screen and the Audiobook Converter's own settings
// dialog.
//
// WHY IT IS EXTRACTED RATHER THAN COPIED, which is this repo's standing rule
// and the reason R8.9 exists: a second place to change a setting through a
// SECOND component gives one idea two vocabularies, and they drift. The Run
// editor was pulled out of ThreadEditor for exactly this reason, so a fact
// recorded on either screen is the same fact. Same here -- there is one
// control, shown twice, reading and writing the same module-level stores.
//
// WHY THE AUDIOBOOK NEEDS IT AT ALL. The Converter is a full-screen world with
// its own sidebar and its own settings dialog, and no route back to the app's
// Settings from inside it. So a writer working on narration who wanted the
// text bigger had to leave the Converter entirely, change it, and come back:
//
//     "I asked for the Font size and text editor size settings to be mirrored
//      over on the Audiobook Settings."
//
// THEMING IS AUTOMATIC AND THAT IS THE POINT OF THE ROLE TOKENS. Every colour
// below names a role (bg-bg-panel, text-text-muted, border-accent-fill), never
// a shade, so inside `.audiobook-theme` these resolve to the charcoal ramp and
// the control looks native there without a single conditional. Do not add
// `isAudiobook` styling props; if something looks wrong on that side, the fix
// belongs in the theme block in App.css.

import { useState, useEffect } from "react";
import { useUiScale, UI_SCALE_PX, type UiScale } from "../../hooks/useUiScale";
import {
  useEditorFontSize, EDITOR_FONT_OPTIONS, resolveEditorFontPx, clampEditorPt,
  EDITOR_PT_MIN, EDITOR_PT_MAX, EDITOR_PT_DEFAULT,
} from "../../hooks/useEditorFontSize";


/** The seven Interface size steps, in the order the screen offers them. */
const UI_SCALE_OPTIONS = [
  { id: "default",     label: "Default" },
  { id: "larger",      label: "Larger" },
  { id: "larger_plus", label: "Larger+" },
  { id: "largest",     label: "Largest" },
  { id: "huge",        label: "Huge" },
  { id: "huge_plus",   label: "Huge+" },
  { id: "maximum",     label: "Maximum" },
] satisfies { id: UiScale; label: string }[];


export function TextSizeControls({
  /**
   * Where this is being rendered, which changes only the WORDS, never the
   * behaviour. In the Converter the writer needs telling that these are
   * app-wide settings rather than per-audiobook ones -- everything else in
   * that dialog belongs to the one book, and a control that silently means
   * something wider is how a writer changes more than they meant to.
   */
  context = "settings",
}: {
  context?: "settings" | "audiobook";
} = {}) {
  const [uiScale, setUiScaleLocal] = useUiScale();
  const { pt: editorPt, set: setEditorPt } = useEditorFontSize();

  // The Custom box's text while the writer types. Committed on blur, never
  // per keystroke -- applying "2" on the way to "24" reflows the manuscript
  // underneath them.
  const [fontDraft, setFontDraft] = useState(String(editorPt));
  const isCustomFont = !EDITOR_FONT_OPTIONS.some(
    o => typeof o.id === "number" && o.id === editorPt,
  );

  // Follow the live value whenever it changes from anywhere else: another copy
  // of this control, or the Ctrl+= / Ctrl+- shortcuts. Typing only moves
  // fontDraft, so this cannot fight the writer mid-entry.
  useEffect(() => {
    setFontDraft(String(editorPt));
  }, [editorPt]);

  const inAudiobook = context === "audiobook";

  return (
    <div className="space-y-6">
      {inAudiobook && (
        // Said before the controls rather than after them: these are the only
        // things in this dialog that are not about this one audiobook.
        <p className="text-mini text-text-muted">
          These two are <strong className="text-text-primary">app-wide</strong>{" "}
          settings, shared with the writing side -- everything else in this
          dialog belongs to this audiobook alone.
        </p>
      )}

      {/* ── Interface size ────────────────────────────────────────────────
          Scales all chrome text -- menus, sidebars, dialogs, labels. Applied
          as a font-size on <html>, which moves every rem-based utility.
          Deliberately does NOT touch the manuscript; that is the control
          below, and the two are separate on the writer's own reasoning that
          chrome cannot be stretched freely without breaking layouts. */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-primary">
          Interface size
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {UI_SCALE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setUiScaleLocal(opt.id)}
              type="button"
              aria-pressed={uiScale === opt.id}
              className={`flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-xs transition-colors ${
                uiScale === opt.id
                  ? "border-accent-fill bg-bg-surface text-text-primary"
                  : "border-border bg-bg-panel text-text-muted hover:border-accent-fill"
              }`}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-text-muted">{UI_SCALE_PX[opt.id]}px</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          Scales menus, chat, Settings, and other interface text -- the app
          around your work, not the work. Your manuscript is sized by{" "}
          <strong>Editor text size</strong> just below. Saved globally.
        </p>
      </div>

      {/* ── Editor text size ──────────────────────────────────────────────
          THE CONTROL THAT DID NOT EXIST until v2.0.4. Three places in the
          code claimed the editor font was handled by the toolbar's font
          picker; that picker chooses a font FAMILY and does not persist.
          Meanwhile the editor hardcoded 16px, which no setting could reach.

          Points rather than pixels, and 12pt rather than "medium", because a
          writer knows what 12pt manuscript looks like -- and 12pt is exactly
          16px, so the default IS what the editor has always rendered. */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-primary">
          Editor text size
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EDITOR_FONT_OPTIONS.map(opt => {
            const isCustom = opt.id === "custom";
            const active = isCustom ? isCustomFont : editorPt === opt.id;
            return (
              <button
                key={String(opt.id)}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (isCustom) {
                    // Seed the box with what is in force, so the writer edits
                    // a number rather than facing a blank field.
                    setFontDraft(String(editorPt));
                  } else {
                    setEditorPt(opt.id as number);
                  }
                }}
                className={`flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-xs transition-colors ${
                  active
                    ? "border-accent-fill bg-bg-surface text-text-primary"
                    : "border-border bg-bg-panel text-text-muted hover:border-accent-fill"
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                {/* The resolved pixel size -- the same number handed to
                    CodeMirror, from the same function, so the label and the
                    page cannot disagree. */}
                <span className="text-text-muted">
                  {isCustom ? "9-24 pt" : `${resolveEditorFontPx(opt.id as number)}px`}
                </span>
              </button>
            );
          })}
        </div>

        {isCustomFont && (
          <div className="mt-3 flex items-center gap-2">
            <label
              htmlFor={`editor-font-pt-${context}`}
              className="text-xs text-text-muted"
            >
              Size in points
            </label>
            <input
              /* The id is scoped to the context because BOTH copies of this
                 control can exist in the DOM at once in a test render, and two
                 elements sharing an id makes the label point at whichever came
                 first. */
              id={`editor-font-pt-${context}`}
              type="number"
              min={EDITOR_PT_MIN}
              max={EDITOR_PT_MAX}
              step={0.5}
              value={fontDraft}
              onChange={e => setFontDraft(e.target.value)}
              onBlur={() => {
                const parsed = Number(fontDraft);
                if (!Number.isFinite(parsed)) {
                  // Put the live value back rather than silently substituting
                  // one the writer did not ask for.
                  setFontDraft(String(editorPt));
                  return;
                }
                const clamped = clampEditorPt(parsed);
                setFontDraft(String(clamped));
                setEditorPt(clamped);
              }}
              className="w-20 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
            />
            <span className="text-xs text-faint">
              = {resolveEditorFontPx(Number(fontDraft) || editorPt)}px
            </span>
          </div>
        )}

        <p className="mt-2 text-xs text-faint">
          Sizes the words in your manuscript, outline, notes and summary
          editors{inAudiobook ? ", and the narration text in this workspace" : ""}
          {" "}-- your writing, not the app around it. 12 pt is standard
          manuscript size and is what this editor has always used. You can also
          press{" "}
          <kbd className="rounded border border-border px-1">Ctrl</kbd>{" "}
          <kbd className="rounded border border-border px-1">+</kbd>{" "}and{" "}
          <kbd className="rounded border border-border px-1">Ctrl</kbd>{" "}
          <kbd className="rounded border border-border px-1">-</kbd>{" "}while
          writing, or{" "}
          <kbd className="rounded border border-border px-1">Ctrl</kbd>{" "}
          <kbd className="rounded border border-border px-1">0</kbd>{" "}to go
          back to {EDITOR_PT_DEFAULT} pt. Saved globally.
        </p>
      </div>
    </div>
  );
}
