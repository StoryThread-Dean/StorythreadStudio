// Settings.tsx -- Expanded Settings Modal
// =========================================
// A scrollable modal overlay for configuring Storythread Studio's AI behaviour,
// model selection, and content preferences.
//
// Sections:
//   1. API & Model Selection -- key, tier slider, text-only toggle, model picker
//   2. Content Settings      -- content mode radio buttons
//   3. App Preferences       -- placeholder for future toggles
//
// The model picker has three sections: Staff Picks, My Favorites, All Models.
// The tier slider filters which models appear; it does NOT change which model
// is actually used for AI calls (that's the explicitly selected model).

import { useState, useEffect, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { X, Eye, EyeOff, CheckCircle, XCircle, Loader, Star, Folder, Sun, Moon } from "lucide-react";
import type { AppSettings, ModelInfo } from "../types/ai";
import { useTheme } from "../hooks/useTheme";
import { useUiScale, UI_SCALE_PX, type UiScale } from "../hooks/useUiScale";
// Content-mode filter, cost tiers, media filter, and the curated recommended
// list all live in a shared util so Settings and ProjectSettings can't drift
// apart (see utils/modelFiltering.ts).
import {
  filterModelByContentMode, RECOMMENDED_MODELS,
  TIERS, tierIndex, modelPassesTier, modelIsTextOnly, type TierValue,
} from "../utils/modelFiltering";

const API_BASE = "http://localhost:8000";

// ── Props ─────────────────────────────────────────────────────────────────────
interface SettingsProps {
  onClose: () => void;
}

// ── Settings Component ────────────────────────────────────────────────────────
export function Settings({ onClose }: SettingsProps) {

  // Loaded settings from backend
  const [settings, setSettings]           = useState<AppSettings | null>(null);

  // API key input (separate from the masked saved key)
  const [apiKeyInput, setApiKeyInput]     = useState("");
  const [showKey, setShowKey]             = useState(false);

  // Model list and selection
  const [models, setModels]               = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  // Tier + filter controls
  const [costTier, setCostTier]           = useState<TierValue>("standard");
  const [textOnlyFilter, setTextOnlyFilter] = useState(true);
  const [starredModels, setStarredModels] = useState<string[]>([]);

  // Content mode
  const [contentMode, setContentMode]     = useState("general");

  // Model routing: allowlist, blocklist, per-model content modes
  const [modelAllowlist, setModelAllowlist]     = useState("");
  const [modelBlocklist, setModelBlocklist]     = useState("");
  const [modelContentModes, setModelContentModes] = useState("");

  // Vault location -- parent folder where new projects/series are auto-placed.
  // The backend resolves an empty string to ~/Documents/Storythread Studio, so we
  // treat "" as a sentinel meaning "use the default".
  const [vaultRoot, setVaultRoot] = useState("");

  // Writing Progress -- skill level drives daily word + task targets shown
  // in the gauge's daily tracker. The Night Owl toggle shifts the day
  // boundary from midnight to 4am for writers who work past midnight.
  const [writingSkillLevel, setWritingSkillLevel] = useState("novice");
  const [nightOwl, setNightOwl] = useState(false);

  // Theme: lives in the global theme store (useTheme), not in local state.
  // The setter applies the change immediately to the DOM and persists to the
  // backend, so there's no separate "save" step for theme like other fields.
  const [theme, setTheme] = useTheme();

  // UI font scale: same global-store pattern as theme. Applies to chrome
  // (menus, chat box, Settings, About, profile labels). The manuscript
  // editor has its own font picker and is unaffected by this control.
  const [uiScale, setUiScaleLocal] = useUiScale();

  // UI state
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [testing, setTesting]             = useState(false);
  const [testResult, setTestResult]       = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [saved, setSaved]                 = useState(false);


  // --- Computed: models visible in the picker ---
  // Applies tier threshold + text-only filter.
  // Always includes the currently selected model (prevents it disappearing).
  const visibleModels = models.filter(m => {
    const textOk = !textOnlyFilter || modelIsTextOnly(m);
    // Content mode filter: mature hides strict providers, explicit whitelists known unmoderated
    const contentOk = filterModelByContentMode(m, contentMode);
    return modelPassesTier(m, costTier) && textOk && contentOk;
  });

  // Is the selected model outside the current tier/filter? (show warning)
  const selectedOutsideTier = Boolean(
    selectedModel &&
    models.length > 0 &&
    !visibleModels.some(m => m.id === selectedModel)
  );

  // Recommended models that (a) still exist in the live fetched list -- so a
  // deprecated slug silently drops out instead of 404-ing later -- AND (b) are
  // appropriate for the current content mode (explicit/mature hide moderated
  // providers). This is the same filter used for the full "All Models" list.
  const availableRecommended = RECOMMENDED_MODELS.filter(rec => {
    const model = models.find(m => m.id === rec.id);
    return model !== undefined && filterModelByContentMode(model, contentMode);
  });

  // At the top "Priority Best" stop, the flagship-class picks get their own
  // pinned group for one-click access. They're pulled OUT of the Recommended
  // group while the flagship group is visible so each model appears once.
  const flagshipPicks = costTier === "premium"
    ? availableRecommended.filter(rec => rec.flagship)
    : [];
  const recommendedPicks = flagshipPicks.length > 0
    ? availableRecommended.filter(rec => !rec.flagship)
    : availableRecommended;

  // User-starred models that exist in the fetched list
  const availableFavorites = starredModels.filter(id =>
    models.some(m => m.id === id)
  );


  // --- Load settings on mount ---
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (!res.ok) throw new Error("Could not load settings.");
        const data: AppSettings = await res.json();
        setSettings(data);
        setSelectedModel(data.default_model);
        setCostTier((data.cost_tier as TierValue) ?? "standard");
        setTextOnlyFilter(data.text_only_filter ?? true);
        setStarredModels(data.starred_models ?? []);
        setContentMode(data.content_mode ?? "general");

        // Model routing state: convert arrays/dicts to text for editing
        setModelAllowlist((data.model_allowlist ?? []).join("\n"));
        setModelBlocklist((data.model_blocklist ?? []).join("\n"));
        // Convert {modelId: ["general","mature"]} to "modelId: general, mature\n..."
        const modesObj = data.model_content_modes ?? {};
        setModelContentModes(
          Object.entries(modesObj)
            .map(([id, modes]) => `${id}: ${(modes as string[]).join(", ")}`)
            .join("\n")
        );

        // Vault location: backend always returns the resolved path (never
        // empty), so we can pre-fill the input directly.
        setVaultRoot(data.vault_root ?? "");

        // Writing Progress: skill level + Night Owl rollover.
        setWritingSkillLevel(data.writing_skill_level ?? "novice");
        setNightOwl((data.day_rollover_hour ?? 0) === 4);

        if (data.openrouter_api_key_set) {
          fetchModels();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load settings.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);


  // --- Fetch model list from OpenRouter ---
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/models`);
      if (!res.ok) return;
      const data: ModelInfo[] = await res.json();
      setModels(data);
    } catch {
      // Not critical -- user can still manually type a model ID
    }
  }, []);


  // --- Toggle a model in/out of starred list ---
  function toggleStar(modelId: string) {
    setStarredModels(prev =>
      prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    );
  }


  // --- Save settings ---
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      // Parse allowlist/blocklist from newline-separated text to arrays
      const parsedAllowlist = modelAllowlist.split("\n").map(s => s.trim()).filter(Boolean);
      const parsedBlocklist = modelBlocklist.split("\n").map(s => s.trim()).filter(Boolean);

      // Parse content modes: "model-id: general, mature" -> {modelId: ["general","mature"]}
      const parsedContentModes: Record<string, string[]> = {};
      for (const line of modelContentModes.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx < 0) continue;
        const modelId = line.slice(0, colonIdx).trim();
        const modes = line.slice(colonIdx + 1).split(",").map(s => s.trim()).filter(Boolean);
        if (modelId && modes.length > 0) {
          parsedContentModes[modelId] = modes;
        }
      }

      const payload: Record<string, unknown> = {
        default_model:        selectedModel,
        cost_tier:            costTier,
        text_only_filter:     textOnlyFilter,
        starred_models:       starredModels,
        content_mode:         contentMode,
        model_allowlist:      parsedAllowlist,
        model_blocklist:      parsedBlocklist,
        model_content_modes:  parsedContentModes,
        // Vault root: empty string tells the backend to reset to the default.
        vault_root:           vaultRoot.trim(),
        // Writing Progress: skill level (driver of daily word + task targets)
        // and day rollover (0 = midnight default, 4 = Night Owl mode).
        writing_skill_level:  writingSkillLevel,
        day_rollover_hour:    nightOwl ? 4 : 0,
      };

      if (apiKeyInput.trim()) {
        payload.openrouter_api_key = apiKeyInput.trim();
      }

      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Save failed.");

      const data: AppSettings = await res.json();
      setSettings(data);
      setApiKeyInput("");
      // Reflect the resolved vault path back -- the backend substitutes the
      // default when we send "", so this re-fills the input with the real
      // path instead of leaving it blank.
      setVaultRoot(data.vault_root ?? "");
      // Mirror Writing Progress fields back from server in case the backend
      // normalized them (e.g. clamped a bad rollover hour to 0).
      setWritingSkillLevel(data.writing_skill_level ?? "novice");
      setNightOwl((data.day_rollover_hour ?? 0) === 4);
      setSaved(true);
      setTestResult(null);

      if (data.openrouter_api_key_set) {
        fetchModels();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }


  // --- Test the API connection ---
  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);

    if (apiKeyInput.trim()) {
      await handleSave();
    }

    try {
      const res = await fetch(`${API_BASE}/api/settings/test-connection`, {
        method: "POST",
      });
      if (!res.ok) {
        // Server returned a non-2xx (e.g. 500). Try to read a detail message;
        // fall back gracefully so res.json() throwing doesn't mask the real
        // problem with "Could not reach the backend."
        let detail = `Server error (${res.status}).`;
        try { const err = await res.json(); detail = err.detail ?? err.error ?? detail; } catch { /* ignore */ }
        setTestResult({ ok: false, message: detail });
        return;
      }
      const data = await res.json();

      if (data.ok) {
        setTestResult({ ok: true, message: `Connected. ${data.model_count} models available.` });
        fetchModels();
      } else {
        setTestResult({ ok: false, message: data.error ?? "Connection failed." });
      }
    } catch {
      setTestResult({ ok: false, message: "Could not reach the backend." });
    } finally {
      setTesting(false);
    }
  }


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal -- wider and scrollable for expanded content */}
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-bg-panel shadow-2xl">

        {/* Sticky header -- inline padding to bypass Tailwind purge */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-border"
          style={{ padding: "1rem 1.5rem" }}
        >
          <h2 className="text-base font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface hover:text-text-primary"
            title="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body -- inline padding to bypass Tailwind purge */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "1.25rem 1.5rem" }}>
          {loading ? (
            <p className="text-sm text-text-muted">Loading settings...</p>
          ) : (
            <div className="space-y-8">

              {/* ── SECTION 1: API & Model Selection ──────────────────────── */}
              <section>
                <h3 className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  API & Model Selection
                </h3>

                {/* OpenRouter API Key */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    OpenRouter API Key
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    {settings?.openrouter_api_key_set
                      ? `Current key: ${settings.openrouter_api_key} -- enter a new key to replace it`
                      : "No key saved. Get one free at openrouter.ai"
                    }
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showKey ? "text" : "password"}
                        value={apiKeyInput}
                        onChange={e => setApiKeyInput(e.target.value)}
                        placeholder="sk-or-v1-..."
                        className="w-full rounded border border-border bg-bg-surface px-3 py-2 pr-8 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={() => setShowKey(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-text-muted"
                        title={showKey ? "Hide key" : "Show key"}
                        type="button"
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <button
                      onClick={handleTest}
                      disabled={testing || saving}
                      className="flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:opacity-50"
                      title="Test if the API key works"
                    >
                      {testing ? <Loader size={12} className="animate-spin" /> : null}
                      Test
                    </button>
                  </div>
                  {testResult && (
                    <div className={`mt-2 flex items-center gap-2 text-xs ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                      {testResult.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
                      {testResult.message}
                    </div>
                  )}
                </div>

                {/* Cost Tier Slider */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Model Cost Tier
                  </label>
                  <p className="mb-3 text-xs text-faint">
                    Filters which models appear in the picker below.
                    Your selected model is always used regardless of this setting.
                    At Priority Best, flagship-class picks are pinned at the top
                    of the list for one-click access.
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={1}
                    value={tierIndex(costTier)}
                    onChange={e => setCostTier(TIERS[parseInt(e.target.value)].value)}
                    className="w-full accent-indigo-500"
                  />
                  {/* Tier labels */}
                  <div className="mt-1 flex justify-between">
                    {TIERS.map((t, i) => (
                      <span
                        key={t.value}
                        className={`text-xs ${
                          i === tierIndex(costTier)
                            ? "font-semibold text-indigo-300"
                            : "text-faint"
                        }`}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Text-Only Filter Toggle */}
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-text-primary">Text-Only Models</p>
                    <p className="text-xs text-faint">
                      Hide models that output images, audio, or video
                    </p>
                  </div>
                  <button
                    onClick={() => setTextOnlyFilter(v => !v)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      textOnlyFilter ? "bg-indigo-600" : "bg-border"
                    }`}
                    title={textOnlyFilter ? "Text-only filter on" : "Text-only filter off"}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        textOnlyFilter ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                {/* Tier conflict warning */}
                {selectedOutsideTier && (
                  <div className="mb-4 rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2">
                    <p className="text-xs text-amber-300">
                      Your selected model is outside the current tier filter. It will still be used
                      until you pick a different one from the list below.
                    </p>
                  </div>
                )}

                {/* Model Picker */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Default Model
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    Used for all AI requests unless overridden. Click a model to select it.
                    Star to add to My Favorites.
                  </p>

                  {models.length === 0 ? (
                    // Fallback: manual text input before models are loaded
                    <>
                      <input
                        type="text"
                        value={selectedModel}
                        onChange={e => setSelectedModel(e.target.value)}
                        placeholder="e.g. openai/gpt-4o-mini"
                        className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1 text-xs text-faint">
                        Test your connection above to load the model list.
                      </p>
                    </>
                  ) : (
                    // Full three-section picker
                    <div className="max-h-72 overflow-y-auto rounded border border-border bg-bg-primary">

                      {/* Flagship -- only at the Priority Best tier stop */}
                      {flagshipPicks.length > 0 && (
                        <>
                          <div className="sticky top-0 bg-bg-primary px-3 py-1.5">
                            <p className="text-xs font-semibold text-amber-400">
                              ★ Flagship
                            </p>
                          </div>
                          {flagshipPicks.map(rec => {
                            const model = models.find(m => m.id === rec.id)!;
                            return (
                              <ModelRow
                                key={rec.id}
                                model={model}
                                note={rec.note}
                                isSelected={selectedModel === rec.id}
                                isStarred={starredModels.includes(rec.id)}
                                onSelect={() => setSelectedModel(rec.id)}
                                onToggleStar={() => toggleStar(rec.id)}
                              />
                            );
                          })}
                          <div className="border-b border-border" />
                        </>
                      )}

                      {/* Recommended */}
                      {recommendedPicks.length > 0 && (
                        <>
                          <div className="sticky top-0 bg-bg-primary px-3 py-1.5">
                            <p className="text-xs font-semibold text-indigo-400">
                              ★ Recommended
                            </p>
                          </div>
                          {recommendedPicks.map(rec => {
                            const model = models.find(m => m.id === rec.id)!;
                            return (
                              <ModelRow
                                key={rec.id}
                                model={model}
                                note={rec.note}
                                isSelected={selectedModel === rec.id}
                                isStarred={starredModels.includes(rec.id)}
                                onSelect={() => setSelectedModel(rec.id)}
                                onToggleStar={() => toggleStar(rec.id)}
                              />
                            );
                          })}
                          <div className="border-b border-border" />
                        </>
                      )}

                      {/* My Favorites */}
                      {availableFavorites.length > 0 && (
                        <>
                          <div className="sticky top-0 bg-bg-primary px-3 py-1.5">
                            <p className="text-xs font-semibold text-teal-400">
                              ★ My Favorites
                            </p>
                          </div>
                          {availableFavorites.map(id => {
                            const model = models.find(m => m.id === id);
                            if (!model) return null;
                            return (
                              <ModelRow
                                key={id}
                                model={model}
                                isSelected={selectedModel === id}
                                isStarred={true}
                                onSelect={() => setSelectedModel(id)}
                                onToggleStar={() => toggleStar(id)}
                              />
                            );
                          })}
                          <div className="border-b border-border" />
                        </>
                      )}

                      {/* All Models (filtered) */}
                      <div className="px-3 py-1.5">
                        <p className="text-xs font-semibold text-text-muted">
                          All Models
                          <span className="ml-1 font-normal text-faint">
                            ({visibleModels.length} shown)
                          </span>
                        </p>
                      </div>
                      {visibleModels.length === 0 ? (
                        <p className="px-3 pb-3 text-xs text-faint">
                          No models match the current tier and filter. Try loosening the settings above.
                        </p>
                      ) : (
                        visibleModels.map(model => (
                          <ModelRow
                            key={model.id}
                            model={model}
                            isSelected={selectedModel === model.id}
                            isStarred={starredModels.includes(model.id)}
                            onSelect={() => setSelectedModel(model.id)}
                            onToggleStar={() => toggleStar(model.id)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              </section>


              {/* ── SECTION 2: Content Settings ───────────────────────────── */}
              <section>
                <h3 className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Content Settings
                </h3>

                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Content Mode
                  </label>
                  <p className="mb-3 text-xs text-faint">
                    Controls how AI assistants handle mature or explicit story content.
                    Applies globally to all AI calls in this app.
                  </p>
                  <div className="flex flex-col gap-3">
                    {[
                      { value: "general",  label: "General",  desc: "Standard fiction -- no adult content" },
                      { value: "mature",   label: "Mature",   desc: "Violence, dark themes, non-explicit adult content" },
                      { value: "explicit", label: "Explicit", desc: "Adult fiction with explicit content -- AI will not filter or moralize" },
                    ].map(option => (
                      <label key={option.value} className="flex cursor-pointer items-start gap-3">
                        <input
                          type="radio"
                          name="contentMode"
                          value={option.value}
                          checked={contentMode === option.value}
                          onChange={() => setContentMode(option.value)}
                          className="mt-0.5 accent-indigo-500"
                        />
                        <div>
                          <p className="text-xs font-medium text-text-primary">{option.label}</p>
                          <p className="text-xs text-faint">{option.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </section>


              {/* ── Appearance ──────────────────────────────────────────────
                  Theme switcher. Unlike the other sections, the theme applies
                  and persists immediately on click -- no separate Save step --
                  because that's the standard pattern users expect for visual
                  preferences (Cmd+Click instant feedback). */}
              <section>
                <h3 className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Appearance
                </h3>

                <div>
                  <label className="mb-2 block text-xs font-medium text-text-primary">
                    Theme
                  </label>
                  <div className="flex gap-2">
                    {/* Each card is its own button, styled so the active one
                        gets an indigo border + accent text. Reads like a
                        segmented control without the visual heaviness of one. */}
                    <button
                      onClick={() => setTheme("dark")}
                      type="button"
                      className={`flex flex-1 items-center gap-2 rounded border px-3 py-2 text-xs transition-colors ${
                        theme === "dark"
                          ? "border-indigo-500 bg-bg-surface text-text-primary"
                          : "border-border bg-bg-panel text-text-muted hover:border-indigo-500"
                      }`}
                    >
                      <Moon size={14} />
                      <span className="font-medium">Dark</span>
                      <span className="text-text-muted">— charcoal navy (default)</span>
                    </button>
                    <button
                      onClick={() => setTheme("light")}
                      type="button"
                      className={`flex flex-1 items-center gap-2 rounded border px-3 py-2 text-xs transition-colors ${
                        theme === "light"
                          ? "border-indigo-500 bg-bg-surface text-text-primary"
                          : "border-border bg-bg-panel text-text-muted hover:border-indigo-500"
                      }`}
                    >
                      <Sun size={14} />
                      <span className="font-medium">Light</span>
                      <span className="text-text-muted">— warm paper</span>
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Switches the entire app between dark and light modes.
                    Saved globally, so the choice carries across all projects.
                  </p>
                </div>

                {/* ── Interface size ──────────────────────────────────────
                    Subtle scale of all chrome text -- menus, chat box,
                    Settings, About, profile labels, etc. The manuscript
                    editor uses its own font picker (in the editor toolbar)
                    and is intentionally NOT affected by this control. */}
                <div className="mt-6">
                  <label className="mb-2 block text-xs font-medium text-text-primary">
                    Interface size
                  </label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([
                      { id: "default",     label: "Default" },
                      { id: "larger",      label: "Larger" },
                      { id: "larger_plus", label: "Larger+" },
                      { id: "largest",     label: "Largest" },
                    ] satisfies { id: UiScale; label: string }[]).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setUiScaleLocal(opt.id)}
                        type="button"
                        className={`flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-xs transition-colors ${
                          uiScale === opt.id
                            ? "border-indigo-500 bg-bg-surface text-text-primary"
                            : "border-border bg-bg-panel text-text-muted hover:border-indigo-500"
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-text-muted">{UI_SCALE_PX[opt.id]}px</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Scales menus, chat, Settings, and other interface text. The
                    manuscript editor's font is controlled separately by the
                    font picker in the editor toolbar. Saved globally.
                  </p>
                </div>
              </section>


              {/* ── SECTION 3: Vault Location ────────────────────────────── */}
              <section>
                <h3 className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Vault Location
                </h3>

                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Project Folder
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    Parent folder where new projects and series are created. You
                    won't be asked to pick a folder for new projects. Existing
                    projects are not moved when you change this.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={vaultRoot}
                      onChange={e => setVaultRoot(e.target.value)}
                      placeholder="C:\\Users\\You\\Documents\\Storythread Studio"
                      className="flex-1 rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={async () => {
                        const picked = await openDialog({
                          directory: true, multiple: false,
                          title: "Choose a parent folder for new Storythread Studio projects",
                        });
                        if (typeof picked === "string") setVaultRoot(picked);
                      }}
                      className="flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
                      title="Browse for a folder"
                      type="button"
                    >
                      <Folder size={12} /> Browse
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Leave blank and save to reset to the default
                    (<code className="text-indigo-400">~/Documents/Storythread Studio</code>).
                  </p>
                </div>
              </section>


              {/* ── SECTION 3b: Writing Progress ───────────────────────────
                  Two controls feed the v1.0.2 Writing Progress gauge:
                    - Skill level: daily word + task targets
                    - Night Owl: shifts the day-rollover boundary
                  Detailed spec: docs/roadmap.md "Writing Progress Tracking". */}
              <section>
                <h3 className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Writing Progress
                </h3>

                {/* Skill level dropdown */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Writing Skill Level
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    Drives the daily word and task targets shown in the
                    project's progress tracker. Pick the level that matches
                    your typical pace -- the gauge celebrates hitting the
                    daily goal, not the difference between levels.
                  </p>
                  <select
                    value={writingSkillLevel}
                    onChange={e => setWritingSkillLevel(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:border-indigo-500"
                  >
                    <option value="newbie">Newbie -- 500 words / 1 task per day</option>
                    <option value="beginner">Beginner -- 750 words / 1 task per day</option>
                    <option value="novice">Novice -- 1,250 words / 2 tasks per day</option>
                    <option value="amateur">Amateur -- 2,500 words / 2 tasks per day</option>
                    <option value="experienced">Experienced -- 4,000 words / 3 tasks per day</option>
                    <option value="fulltime">Full-time -- 7,500 words / 3 tasks per day</option>
                    <option value="professional">Professional -- 10,000 words / 4 tasks per day</option>
                  </select>
                  <p className="mt-2 text-xs text-faint">
                    A "task" is one tracked file edited per day (manuscript,
                    notes, outline, profile). Running a Smart Advisor Default
                    pass on a chapter also earns it a task credit.
                  </p>
                </div>

                {/* Night Owl rollover toggle */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Day Rollover
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    When does "today" become "tomorrow" for daily-goal
                    accounting? Midnight is standard. Night Owl mode shifts
                    the boundary to 4 AM so a 1 AM writing session still
                    counts toward the previous day's goal.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setNightOwl(false)}
                      type="button"
                      className={`flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-xs transition-colors ${
                        !nightOwl
                          ? "border-indigo-500 bg-bg-surface text-text-primary"
                          : "border-border bg-bg-panel text-text-muted hover:border-indigo-500"
                      }`}
                    >
                      <span className="font-medium">Midnight (default)</span>
                      <span className="text-text-muted">Day rolls over at 12:00 AM</span>
                    </button>
                    <button
                      onClick={() => setNightOwl(true)}
                      type="button"
                      className={`flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-xs transition-colors ${
                        nightOwl
                          ? "border-indigo-500 bg-bg-surface text-text-primary"
                          : "border-border bg-bg-panel text-text-muted hover:border-indigo-500"
                      }`}
                    >
                      <span className="font-medium">Night Owl</span>
                      <span className="text-text-muted">Day rolls over at 4:00 AM</span>
                    </button>
                  </div>
                </div>
              </section>


              {/* ── SECTION 4: Model Routing ─────────────────────────────── */}
              <section>
                <h3 className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Model Routing
                </h3>

                {/* Allowlist */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Model Allowlist
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    If set, only these models can be used. One model ID per line. Leave empty to allow all models.
                  </p>
                  <textarea
                    value={modelAllowlist}
                    onChange={e => setModelAllowlist(e.target.value)}
                    rows={3}
                    placeholder={"e.g.\nanthropic/claude-3.5-sonnet\nopenai/gpt-4o-mini"}
                    className="w-full resize-y rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Blocklist */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Model Blocklist
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    These models are excluded from selection. Ignored if allowlist is set. One model ID per line.
                  </p>
                  <textarea
                    value={modelBlocklist}
                    onChange={e => setModelBlocklist(e.target.value)}
                    rows={3}
                    placeholder="e.g.\ngoogle/gemma-2-9b-it:free"
                    className="w-full resize-y rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Per-model content modes */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">
                    Model Content Modes
                  </label>
                  <p className="mb-2 text-xs text-faint">
                    Configure which content modes each model supports. Format: one entry per line as
                    <code className="mx-1 text-indigo-400">model-id: general, mature, explicit</code>
                    Models not listed default to "general" only.
                  </p>
                  <textarea
                    value={modelContentModes}
                    onChange={e => setModelContentModes(e.target.value)}
                    rows={4}
                    placeholder={"e.g.\nanthropic/claude-3.5-sonnet: general, mature\ndeepseek/deepseek-chat: general, mature, explicit"}
                    className="w-full resize-y rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                  />
                </div>
              </section>

            </div>
          )}
        </div>

        {/* Sticky footer -- inline padding to bypass Tailwind purge */}
        <div className="shrink-0 border-t border-border" style={{ padding: "1rem 1.5rem" }}>
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          {saved && !error && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle size={13} /> Settings saved.
            </p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}


// ── ModelRow ──────────────────────────────────────────────────────────────────
// One clickable row in the model picker.
// Shows model name, cost, optional note, and a star toggle.

interface ModelRowProps {
  model: ModelInfo;
  note?: string;
  isSelected: boolean;
  isStarred: boolean;
  onSelect: () => void;
  onToggleStar: () => void;
}

function ModelRow({ model, note, isSelected, isStarred, onSelect, onToggleStar }: ModelRowProps) {
  const costLabel = model.is_free
    ? "free"
    : `$${model.cost_input_per_million.toFixed(2)}/M`;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-bg-panel ${
        isSelected ? "bg-indigo-900/20" : ""
      }`}
    >
      {/* Clickable area (name + cost + note) */}
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={`Select ${model.name}`}
      >
        {/* Selection indicator */}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isSelected ? "bg-indigo-400" : "bg-transparent"
          }`}
        />
        <div className="min-w-0">
          <p className={`truncate text-xs ${isSelected ? "text-indigo-300 font-medium" : "text-text-primary"}`}>
            {model.name}
          </p>
          {note && (
            <p className="text-xs text-text-muted">{note}</p>
          )}
        </div>
        <span className={`ml-auto shrink-0 text-xs ${model.is_free ? "text-emerald-500" : "text-faint"}`}>
          {costLabel}
        </span>
      </button>

      {/* Star toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
        className={`shrink-0 transition-colors ${
          isStarred ? "text-amber-400" : "text-faint hover:text-text-muted"
        }`}
        title={isStarred ? "Remove from favorites" : "Add to favorites"}
      >
        <Star size={13} fill={isStarred ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
