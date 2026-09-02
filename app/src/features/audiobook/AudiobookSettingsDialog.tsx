// features/audiobook/AudiobookSettingsDialog.tsx
// ==============================================
// Everything about HOW this audiobook is narrated, in one place, out of
// the way of the work: which engine, which keys it may spend, and the
// book's pacing. Reached by the gear at the bottom of the chapter rail.
//
// Why a modal, and why in the audiobook's own zinc/jewel palette rather
// than the writing app's theme tokens: the content is exactly what was
// crowding the 288px rail, so it needs room; and the writing app's tokens
// flip with its light theme, which would render this card near-white
// inside a workspace that is permanently dark.
//
// Manual save, like everything else here: nothing is written until Save,
// and closing with unsaved changes asks first. Two things are saved --
// the GLOBAL narration engine/keys and this BOOK's pacing -- and only the
// dirty half is sent.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Settings as SettingsIcon, X } from "lucide-react";

import {
  fetchAudiobookSettings, fetchNarrationSettings, fetchTtsCatalog, fetchVoices,
  saveAudiobookSettings, saveNarrationSettings,
} from "./api";
import type {
  AudiobookSettings, NarrationSettings, NarrationTier, TtsCatalog,
} from "./api";
import { NarrationEngineSection } from "./NarrationEngineSection";
import { NarrationKeysSection } from "./NarrationKeysSection";
import { NarrationPacingSection } from "./NarrationPacingSection";
import type { NarratorVoice } from "./types";
// The SAME component the Settings screen renders, not a copy of it. The
// Converter is a full-screen world with no route back to app Settings, so a
// writer who wanted the narration text bigger had to leave it entirely.
// Rendering the real control here keeps one setting with one implementation;
// it themes itself to the charcoal ramp because it names roles, not shades.
import { TextSizeControls } from "../../components/settings/TextSizeControls";
// Line spacing too: the narration editor already OBEYS this setting (it takes
// its line-height from the same store), but the knob lived only on a screen
// you had to leave the Converter to reach. Paragraph spacing is deliberately
// NOT brought over -- it pads per-paragraph elements and a textarea has none.
import { LineSpacingControl } from "../../components/settings/LineSpacingControl";
import { AudiobookThemeSection } from "./AudiobookThemeSection";

interface AudiobookSettingsDialogProps {
  workspacePath: string;
  onClose: () => void;
  /** Saved successfully -- the rail refetches what depends on this. */
  onSaved: () => void;
}

export function AudiobookSettingsDialog({
  workspacePath, onClose, onSaved,
}: AudiobookSettingsDialogProps) {
  const [settings, setSettings] = useState<AudiobookSettings | null>(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState("");
  const [pacing, setPacing] = useState<NarrationSettings | null>(null);
  const [pacingSnapshot, setPacingSnapshot] = useState("");
  const [catalog, setCatalog] = useState<TtsCatalog | null>(null);
  const [localVoices, setLocalVoices] = useState<NarratorVoice[]>([]);
  // Key inputs start BLANK and are only ever sent when non-empty: echoing
  // a masked value back would store "sk-or-...wxyz" as the key.
  const [keyInputs, setKeyInputs] = useState({ openrouter: "", nanogpt: "" });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [fetchedSettings, fetchedPacing, fetchedCatalog] = await Promise.all([
          fetchAudiobookSettings(),
          fetchNarrationSettings(workspacePath),
          fetchTtsCatalog(),
        ]);
        if (cancelled) return;
        setSettings(fetchedSettings);
        setSettingsSnapshot(JSON.stringify(fetchedSettings));
        setPacing(fetchedPacing);
        setPacingSnapshot(JSON.stringify(fetchedPacing));
        setCatalog(fetchedCatalog);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load audiobook settings.");
        }
      }
      // The voice roster is a nice-to-have here (it fills the premium
      // voice list for hosted Kokoro); never let it fail the dialog.
      try {
        const voices = await fetchVoices();
        if (!cancelled) setLocalVoices(voices);
      } catch { /* the curated fallback list covers it */ }
    })();
    return () => { cancelled = true; };
  }, [workspacePath]);

  useEffect(() => { closeRef.current?.focus(); }, []);

  const settingsDirty = useMemo(
    () => settings !== null && JSON.stringify(settings) !== settingsSnapshot,
    [settings, settingsSnapshot]);
  const pacingDirty = useMemo(
    () => pacing !== null && JSON.stringify(pacing) !== pacingSnapshot,
    [pacing, pacingSnapshot]);
  const keysTyped = keyInputs.openrouter.trim() !== "" || keyInputs.nanogpt.trim() !== "";
  const dirty = settingsDirty || pacingDirty || keysTyped;

  const attemptClose = useCallback(() => {
    // Manual-save world: leaving with unsaved settings needs a real yes.
    // Without this the reorganization would CREATE a silent failure --
    // tweak the pace, close, preview, hear nothing change.
    if (dirty && !window.confirm(
      "You have unsaved audiobook settings. Close without saving?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") attemptClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attemptClose]);

  const chooseEngine = useCallback((tier: NarrationTier) => {
    setSettings(prev => prev && {
      ...prev,
      // The free tier means "no hosted engine chosen".
      narration_provider: tier.requires_key ? tier.provider : "",
      narration_model: tier.requires_key ? tier.model : "",
    });
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (settingsDirty || keysTyped) {
        const patch: Parameters<typeof saveAudiobookSettings>[0] = {
          use_writing_keys: settings.use_writing_keys,
          narration_provider: settings.narration_provider,
          narration_model: settings.narration_model,
          premium_voice: settings.premium_voice,
        };
        // Only ever send a key the writer just typed.
        if (keyInputs.openrouter.trim()) {
          patch.openrouter_api_key = keyInputs.openrouter.trim();
        }
        if (keyInputs.nanogpt.trim()) {
          patch.nanogpt_api_key = keyInputs.nanogpt.trim();
        }
        const fresh = await saveAudiobookSettings(patch);
        setSettings(fresh);
        setSettingsSnapshot(JSON.stringify(fresh));
        setKeyInputs({ openrouter: "", nanogpt: "" });
      }
      if (pacingDirty && pacing) {
        const fresh = await saveNarrationSettings(workspacePath, pacing);
        setPacing(fresh);
        setPacingSnapshot(JSON.stringify(fresh));
      }
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }, [keyInputs, keysTyped, onSaved, pacing, pacingDirty, saving, settings,
      settingsDirty, workspacePath]);

  const clearKey = useCallback(async (provider: "openrouter" | "nanogpt") => {
    setError(null);
    try {
      const fresh = await saveAudiobookSettings(
        provider === "openrouter" ? { openrouter_api_key: "" } : { nanogpt_api_key: "" });
      setSettings(fresh);
      setSettingsSnapshot(JSON.stringify(fresh));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the key.");
    }
  }, [onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">
          <SettingsIcon size={15} className="text-secondary" />
          <h2 className="flex-1 text-sm font-semibold text-text-primary">
            Audiobook Settings
          </h2>
          <button
            ref={closeRef}
            onClick={attemptClose}
            aria-label="Close audiobook settings"
            className="rounded p-1 text-faint hover:text-text-primary"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!settings || !pacing ? (
            <p className="text-xs text-text-muted">
              <Loader2 size={12} className="mr-1 inline animate-spin" />
              Loading settings...
            </p>
          ) : (
            <div className="space-y-7">
              <NarrationEngineSection
                catalog={catalog}
                chosenProvider={settings.narration_provider}
                chosenModel={settings.narration_model}
                premiumVoice={settings.premium_voice}
                localVoices={localVoices}
                onChoose={chooseEngine}
                onPremiumVoiceChange={voice => {
                  setSettings(prev => prev && { ...prev, premium_voice: voice });
                  setSaved(false);
                }}
              />
              <NarrationKeysSection
                settings={settings}
                keyInputs={keyInputs}
                showKey={showKey}
                onKeyInput={(provider, value) => {
                  setKeyInputs(prev => ({ ...prev, [provider]: value }));
                  setSaved(false);
                }}
                onToggleShowKey={() => setShowKey(v => !v)}
                onUseWritingKeysChange={next => {
                  setSettings(prev => prev && { ...prev, use_writing_keys: next });
                  setSaved(false);
                }}
                onClearKey={provider => void clearKey(provider)}
              />
              <NarrationPacingSection
                pacing={pacing}
                dirty={pacingDirty}
                saved={saved && !pacingDirty}
                onChange={next => { setPacing(next); setSaved(false); }}
              />

              {/* Text size, LAST on purpose. Everything above belongs to this
                  audiobook; these two are app-wide, and the section says so
                  itself. Placed after the book's own settings rather than
                  before them so the dialog reads book-first.

                  These save themselves the moment they are clicked -- they go
                  through the same stores as the writing app, which persist on
                  change. They are deliberately NOT part of this dialog's
                  dirty/Save flow, or a writer could resize their text, hit
                  Cancel, and be surprised twice. */}
              <div className="space-y-6 border-t border-border pt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Look and feel
                </h3>
                {/* The Converter's own theme sits with the size controls
                    rather than with the narration settings above: these are
                    all look-and-feel choices, and the two that are app-wide
                    say so themselves. */}
                <AudiobookThemeSection />
                <TextSizeControls context="audiobook" />
                <LineSpacingControl context="audiobook" />
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border px-5 py-3">
          {error && (
            <p className="min-w-0 flex-1 truncate text-mini text-danger" title={error}>
              {error}
            </p>
          )}
          {!error && saved && !dirty && (
            <p className="flex-1 text-mini text-accent">Settings saved.</p>
          )}
          {!error && !saved && dirty && (
            <p className="flex-1 text-mini text-warn">Unsaved changes.</p>
          )}
          {!error && !saved && !dirty && <span className="flex-1" />}
          <button
            onClick={attemptClose}
            className="rounded border border-border px-3 py-1.5 text-xs text-text-primary hover:border-border-strong"
          >
            Close
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded bg-accent-fill px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-fill disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
