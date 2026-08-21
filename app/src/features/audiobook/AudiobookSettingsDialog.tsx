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
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-5 py-3">
          <SettingsIcon size={15} className="text-blue-300" />
          <h2 className="flex-1 text-sm font-semibold text-zinc-100">
            Audiobook Settings
          </h2>
          <button
            ref={closeRef}
            onClick={attemptClose}
            aria-label="Close audiobook settings"
            className="rounded p-1 text-zinc-500 hover:text-zinc-100"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!settings || !pacing ? (
            <p className="text-xs text-zinc-400">
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
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-zinc-800 px-5 py-3">
          {error && (
            <p className="min-w-0 flex-1 truncate text-mini text-rose-300" title={error}>
              {error}
            </p>
          )}
          {!error && saved && !dirty && (
            <p className="flex-1 text-mini text-emerald-300">Settings saved.</p>
          )}
          {!error && !saved && dirty && (
            <p className="flex-1 text-mini text-amber-300">Unsaved changes.</p>
          )}
          {!error && !saved && !dirty && <span className="flex-1" />}
          <button
            onClick={attemptClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Close
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
