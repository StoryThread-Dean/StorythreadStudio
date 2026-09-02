// components/settings/LineSpacingControl.tsx -- how far apart the lines sit
// ==========================================================================
// The Line spacing control, as ONE component rendered in two places: the
// Settings screen and the Audiobook Converter's settings dialog.
//
// Extracted for the same reason TextSizeControls was, and the reason is this
// repo's standing rule rather than a preference: a second place to change a
// setting through a SECOND component gives one idea two vocabularies, and they
// drift. See R8.9 and the Run editor, which was pulled out of ThreadEditor
// rather than copied.
//
// WHY IT BELONGS IN THE CONVERTER. The narration editor is the writer's own
// manuscript prose, and it already obeys this setting -- it takes its
// line-height from the same store. But the control lived only on a screen you
// had to leave the Converter to reach, so the effect was there and the knob
// was not:
//
//     "The Line spacing is something that should be brought over as well, or
//      at the very least the linespacing effect should extend over to the
//      Audiobook Generator's text editor side."
//
// PARAGRAPH SPACING IS DELIBERATELY NOT HERE, and that is a fact about the
// surface rather than an omission. Paragraph spacing works by padding
// `.cm-line`, and CodeMirror gives one such element per source line. The
// narration editor is a plain <textarea> -- one element holding all the text,
// with no per-paragraph node to pad -- so the control would render, accept a
// value, save it, and do nothing visible on this side. A dead knob is worse
// than an absent one, so the Converter says where that setting lives instead.
//
// Colour comes from ROLE tokens only, so this renders native inside
// `.audiobook-theme` without a single conditional.

import { useState, useEffect } from "react";
import {
  useEditorSpacing, LINE_SPACING_OPTIONS, resolveLineHeight, clampMultiple,
  MULTIPLE_MIN, MULTIPLE_MAX,
} from "../../hooks/useEditorSpacing";


export function LineSpacingControl({
  /**
   * Changes the WORDS only, never the behaviour. In the Converter the writer
   * needs telling that this is app-wide, and that its sibling control
   * (paragraph spacing) has no effect on a textarea and lives elsewhere.
   */
  context = "settings",
}: {
  context?: "settings" | "audiobook";
} = {}) {
  const {
    spacing, multiple: spacingMultiple, set: setSpacing,
  } = useEditorSpacing();

  // The text in the Multiple box while the writer is still typing it. The
  // applied value only changes on blur, so typing "2" on the way to "2.5"
  // does not reflow the manuscript twice.
  const [multipleDraft, setMultipleDraft] = useState(String(spacingMultiple));

  // Follow the live value when it changes from anywhere else -- the other copy
  // of this control, or a fresh load from the backend. Typing only moves
  // multipleDraft, so this cannot fight the writer mid-entry.
  useEffect(() => {
    setMultipleDraft(String(spacingMultiple));
  }, [spacingMultiple]);

  const inAudiobook = context === "audiobook";

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-text-primary">
        Line spacing
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LINE_SPACING_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => setSpacing(opt.id, spacingMultiple)}
            type="button"
            aria-pressed={spacing === opt.id}
            className={`flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-xs transition-colors ${
              spacing === opt.id
                ? "border-accent-fill bg-bg-surface text-text-primary"
                : "border-border bg-bg-panel text-text-muted hover:border-accent-fill"
            }`}
          >
            <span className="font-medium">{opt.label}</span>
            {/* The resolved line-height, to two decimals. The same number the
                editor is handed, from the same function, so what this says and
                what the page does cannot drift. It is also the only thing that
                makes Multiple reasonable to use. */}
            <span className="text-text-muted">
              {resolveLineHeight(opt.id, spacingMultiple).toFixed(2)}
            </span>
          </button>
        ))}
      </div>

      {/* The custom multiplier. Only meaningful for Multiple, so it only
          appears then -- a permanently visible input that does nothing three
          times out of four is a question the writer has to answer and then
          discover was irrelevant. */}
      {spacing === "multiple" && (
        <div className="mt-3 flex items-center gap-2">
          <label
            /* Scoped id: both copies of this control can be in the DOM at once
               in a test render, and a duplicate id makes the label point at
               whichever came first. */
            htmlFor={`line-spacing-multiple-${context}`}
            className="text-xs text-text-muted"
          >
            Multiple of a single line
          </label>
          <input
            id={`line-spacing-multiple-${context}`}
            type="number"
            min={MULTIPLE_MIN}
            max={MULTIPLE_MAX}
            step={0.05}
            value={multipleDraft}
            onChange={e => setMultipleDraft(e.target.value)}
            /* Committed on blur rather than per keystroke: typing "2" on the
               way to "2.5" would otherwise apply 2 and reflow the manuscript
               underneath the writer. */
            onBlur={() => {
              const parsed = Number(multipleDraft);
              if (!Number.isFinite(parsed)) {
                // Not a number: put the live value back rather than silently
                // substituting one that was not asked for.
                setMultipleDraft(String(spacingMultiple));
                return;
              }
              const clamped = clampMultiple(parsed);
              setMultipleDraft(String(clamped));
              setSpacing("multiple", clamped);
            }}
            className="w-20 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
          />
          <span className="text-xs text-faint">
            = {resolveLineHeight("multiple", spacingMultiple).toFixed(2)} line height
          </span>
        </div>
      )}

      <p className="mt-2 text-xs text-faint">
        {inAudiobook ? (
          <>
            Spaces the lines of the narration text here, and of your
            manuscript, outline, notes and summary editors on the writing
            side -- your writing, not the app around it. Measured the way a
            word processor measures it, so Single is the font's own natural
            line height rather than a flat 1.0.{" "}
            <strong className="text-text-muted">Paragraph spacing</strong> is a
            separate setting and lives in the app's own Settings: it works by
            padding each paragraph, and this narration box is one plain text
            field with no separate paragraphs to pad, so it would do nothing
            here. Saved globally.
          </>
        ) : (
          <>
            Spaces the lines in the manuscript, outline, notes, summary editors
            and the Audiobook Converter's narration text -- your writing, not
            the app around it. Measured the way a word processor measures it,
            so Single is the font's own natural line height rather than a flat
            1.0. Interface size above is the separate control for menus and
            labels. Saved globally.
          </>
        )}
      </p>
    </div>
  );
}
