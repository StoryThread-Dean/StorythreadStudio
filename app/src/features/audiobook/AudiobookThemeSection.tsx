// features/audiobook/AudiobookThemeSection.tsx -- the Converter's own theme
// ===========================================================================
// Dark / Light / Custom for the Audiobook Converter, in its own settings
// dialog. Added 2026-09-02 on the writer's ruling; spec 5.0 amended to match.
//
// WHY THE CONVERTER GETS ITS OWN SWITCH RATHER THAN FOLLOWING THE APP'S.
// Spec 5.0 argued that charcoal in both app themes was the point: the writer
// should always know which side of the app they are standing in. That is still
// the DEFAULT, and it is still a good one -- what changed is that it became a
// choice rather than a rule. Keying it to the writing app's theme would have
// made one switch silently restyle a feature the writer was not looking at,
// and would have forbidden a dark writing app beside a paper Converter, which
// is a combination somebody can reasonably want.
//
// This section sits ABOVE Text size and spacing but below the narration
// settings, because it is the same KIND of thing as the size controls -- a
// look-and-feel choice rather than something about this one audiobook -- and
// the two say so together.

import { useState } from "react";
import { Moon, Sun, Palette } from "lucide-react";
import {
  useAudiobookTheme, storedAudiobookPalette, previewAudiobookPalette,
  revertAudiobookPreview, setAudiobookPalette, setAudiobookTheme,
  type AudiobookTheme,
} from "../theme/useAudiobookTheme";
import {
  CustomThemeEditor, type ThemeTarget,
} from "../theme/CustomThemeEditor";


/**
 * The Converter's palette as a target for the shared colour editor.
 *
 * Deliberately the SAME editor the writing app uses, parameterised rather than
 * copied -- a second 56-row colour grid would be the clearest possible case of
 * the drift this codebase keeps finding. Only these five functions differ.
 */
export const AUDIOBOOK_TARGET: ThemeTarget = {
  title: "Audiobook custom theme",
  shippedLabel: "Use Charcoal instead",
  getStored: storedAudiobookPalette,
  preview: previewAudiobookPalette,
  revert: revertAudiobookPreview,
  save: setAudiobookPalette,
  useShipped: () => { void setAudiobookTheme("dark"); },
};


const OPTIONS: { id: AudiobookTheme; label: string; note: string }[] = [
  { id: "dark",   label: "Charcoal", note: "jewel tones (default)" },
  { id: "light",  label: "Paper",    note: "warm, like the editor" },
  { id: "custom", label: "Custom",   note: "assign your colors" },
];


export function AudiobookThemeSection() {
  const { theme, set } = useAudiobookTheme();
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-text-primary">
        Audiobook theme
      </label>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(opt => {
          const Icon = opt.id === "dark" ? Moon : opt.id === "light" ? Sun : Palette;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={theme === opt.id}
              onClick={() => {
                if (opt.id === "custom") {
                  // Opening the editor does NOT switch the theme, and that
                  // ordering matters: switching first would repaint from an
                  // empty palette (charcoal), so a writer on Paper would find
                  // the editor seeded from charcoal instead of from the theme
                  // they were actually looking at. The switch happens on Save.
                  setEditing(true);
                  return;
                }
                set(opt.id);
              }}
              className={`flex flex-1 items-center gap-2 rounded border px-3 py-2 text-xs transition-colors ${
                theme === opt.id
                  ? "border-accent-fill bg-bg-surface text-text-primary"
                  : "border-border bg-bg-panel text-text-muted hover:border-accent-fill"
              }`}
            >
              <Icon size={14} />
              <span className="font-medium">{opt.label}</span>
              <span className="text-text-muted">{opt.note}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">
        The Converter keeps its own look, separate from the writing side, so a
        dark editor beside a paper Converter is a perfectly good combination.
        Charcoal with jewel accents is the default and the one the walkthroughs
        were drawn for. Saved globally.
      </p>

      {theme === "custom" && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-accent-fill hover:text-text-primary"
        >
          <Palette size={12} /> Edit my colours
        </button>
      )}

      {editing && (
        // Rendered INSIDE the Converter's subtree, which is what makes the
        // editor read this side's colours when it seeds itself and theme
        // itself to this side's palette while it is open.
        <CustomThemeEditor
          target={AUDIOBOOK_TARGET}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
