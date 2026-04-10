// Settings.tsx -- Expanded Settings Modal
// =========================================
// A scrollable modal overlay for configuring StoryForge's AI behaviour,
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
import { X, Eye, EyeOff, CheckCircle, XCircle, Loader, Star } from "lucide-react";
import type { AppSettings, ModelInfo } from "../types/ai";

const API_BASE = "http://localhost:8000";

// ── Staff Picks ───────────────────────────────────────────────────────────────
// Curated list of models that work well for fiction writing.
// Only shown if the model ID is present in the live fetched model list.
// Update this list when the app is updated -- IDs are OpenRouter model IDs.
const STAFF_PICKS: { id: string; note: string }[] = [
  { id: "anthropic/claude-3.5-sonnet",  note: "Best for prose quality"      },
  { id: "anthropic/claude-3.5-haiku",   note: "Fast, quality, affordable"   },
  { id: "deepseek/deepseek-chat",       note: "Best budget option"           },
  { id: "openai/gpt-4o-mini",           note: "Fast, capable, low cost"     },
  { id: "google/gemma-2-9b-it:free",    note: "Best free option"             },
];

// ── Tier Slider ───────────────────────────────────────────────────────────────
// Maps a 0-3 integer position to a label and a filter function.
// The filter is applied to the model list to compute what the picker shows.
const TIERS = [
  { value: "free",     label: "Free Only",      threshold: 0    },
  { value: "budget",   label: "Budget",          threshold: 1.0  },
  { value: "standard", label: "Standard",        threshold: 15.0 },
  { value: "premium",  label: "Premium",         threshold: Infinity },
] as const;

type TierValue = (typeof TIERS)[number]["value"];

function tierIndex(value: TierValue): number {
  return TIERS.findIndex(t => t.value === value);
}

function modelPassesTier(m: ModelInfo, tier: TierValue): boolean {
  if (tier === "free")     return m.is_free;
  if (tier === "budget")   return m.cost_input_per_million <= 1.0;
  if (tier === "standard") return m.cost_input_per_million <= 15.0;
  return true; // premium: everything
}

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
    const textOk = !textOnlyFilter
      || m.output_modalities.every(mod => mod === "text")
      || m.output_modalities.length === 0;
    return modelPassesTier(m, costTier) && textOk;
  });

  // Is the selected model outside the current tier/filter? (show warning)
  const selectedOutsideTier = Boolean(
    selectedModel &&
    models.length > 0 &&
    !visibleModels.some(m => m.id === selectedModel)
  );

  // Staff picks that actually exist in the fetched model list
  const availableStaffPicks = STAFF_PICKS.filter(sp =>
    models.some(m => m.id === sp.id)
  );

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
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] shadow-2xl">

        {/* Sticky header -- inline padding to bypass Tailwind purge */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-[#1e1e4a]"
          style={{ padding: "1rem 1.5rem" }}
        >
          <h2 className="text-base font-semibold text-[#f0f0f5]">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-[#f0f0f5]"
            title="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body -- inline padding to bypass Tailwind purge */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "1.25rem 1.5rem" }}>
          {loading ? (
            <p className="text-sm text-[#8888aa]">Loading settings...</p>
          ) : (
            <div className="space-y-8">

              {/* ── SECTION 1: API & Model Selection ──────────────────────── */}
              <section>
                <h3 className="mb-4 border-b border-[#1e1e4a] pb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                  API & Model Selection
                </h3>

                {/* OpenRouter API Key */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    OpenRouter API Key
                  </label>
                  <p className="mb-2 text-xs text-[#3f3f7a]">
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
                        className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 pr-8 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={() => setShowKey(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#3f3f7a] hover:text-[#8888aa]"
                        title={showKey ? "Hide key" : "Show key"}
                        type="button"
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <button
                      onClick={handleTest}
                      disabled={testing || saving}
                      className="flex items-center gap-1.5 rounded border border-[#1e1e4a] px-3 py-2 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-[#f0f0f5] disabled:opacity-50"
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
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    Model Cost Tier
                  </label>
                  <p className="mb-3 text-xs text-[#3f3f7a]">
                    Filters which models appear in the picker below.
                    Your selected model is always used regardless of this setting.
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
                            : "text-[#3f3f7a]"
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
                    <p className="text-xs font-medium text-[#f0f0f5]">Text-Only Models</p>
                    <p className="text-xs text-[#3f3f7a]">
                      Hide models that output images, audio, or video
                    </p>
                  </div>
                  <button
                    onClick={() => setTextOnlyFilter(v => !v)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      textOnlyFilter ? "bg-indigo-600" : "bg-[#1e1e4a]"
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
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    Default Model
                  </label>
                  <p className="mb-2 text-xs text-[#3f3f7a]">
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
                        className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1 text-xs text-[#3f3f7a]">
                        Test your connection above to load the model list.
                      </p>
                    </>
                  ) : (
                    // Full three-section picker
                    <div className="max-h-72 overflow-y-auto rounded border border-[#1e1e4a] bg-[#070724]">

                      {/* Staff Picks */}
                      {availableStaffPicks.length > 0 && (
                        <>
                          <div className="sticky top-0 bg-[#070724] px-3 py-1.5">
                            <p className="text-xs font-semibold text-indigo-400">
                              ★ Staff Picks
                            </p>
                          </div>
                          {availableStaffPicks.map(sp => {
                            const model = models.find(m => m.id === sp.id)!;
                            return (
                              <ModelRow
                                key={sp.id}
                                model={model}
                                note={sp.note}
                                isSelected={selectedModel === sp.id}
                                isStarred={starredModels.includes(sp.id)}
                                onSelect={() => setSelectedModel(sp.id)}
                                onToggleStar={() => toggleStar(sp.id)}
                              />
                            );
                          })}
                          <div className="border-b border-[#1e1e4a]" />
                        </>
                      )}

                      {/* My Favorites */}
                      {availableFavorites.length > 0 && (
                        <>
                          <div className="sticky top-0 bg-[#070724] px-3 py-1.5">
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
                          <div className="border-b border-[#1e1e4a]" />
                        </>
                      )}

                      {/* All Models (filtered) */}
                      <div className="px-3 py-1.5">
                        <p className="text-xs font-semibold text-[#8888aa]">
                          All Models
                          <span className="ml-1 font-normal text-[#3f3f7a]">
                            ({visibleModels.length} shown)
                          </span>
                        </p>
                      </div>
                      {visibleModels.length === 0 ? (
                        <p className="px-3 pb-3 text-xs text-[#3f3f7a]">
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
                <h3 className="mb-4 border-b border-[#1e1e4a] pb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                  Content Settings
                </h3>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    Content Mode
                  </label>
                  <p className="mb-3 text-xs text-[#3f3f7a]">
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
                          <p className="text-xs font-medium text-[#f0f0f5]">{option.label}</p>
                          <p className="text-xs text-[#3f3f7a]">{option.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </section>


              {/* ── SECTION 3: Model Routing ─────────────────────────────── */}
              <section>
                <h3 className="mb-4 border-b border-[#1e1e4a] pb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                  Model Routing
                </h3>

                {/* Allowlist */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    Model Allowlist
                  </label>
                  <p className="mb-2 text-xs text-[#3f3f7a]">
                    If set, only these models can be used. One model ID per line. Leave empty to allow all models.
                  </p>
                  <textarea
                    value={modelAllowlist}
                    onChange={e => setModelAllowlist(e.target.value)}
                    rows={3}
                    placeholder={"e.g.\nanthropic/claude-3.5-sonnet\nopenai/gpt-4o-mini"}
                    className="w-full resize-y rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-xs text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Blocklist */}
                <div className="mb-5">
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    Model Blocklist
                  </label>
                  <p className="mb-2 text-xs text-[#3f3f7a]">
                    These models are excluded from selection. Ignored if allowlist is set. One model ID per line.
                  </p>
                  <textarea
                    value={modelBlocklist}
                    onChange={e => setModelBlocklist(e.target.value)}
                    rows={3}
                    placeholder="e.g.\ngoogle/gemma-2-9b-it:free"
                    className="w-full resize-y rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-xs text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Per-model content modes */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#f0f0f5]">
                    Model Content Modes
                  </label>
                  <p className="mb-2 text-xs text-[#3f3f7a]">
                    Configure which content modes each model supports. Format: one entry per line as
                    <code className="mx-1 text-indigo-400">model-id: general, mature, explicit</code>
                    Models not listed default to "general" only.
                  </p>
                  <textarea
                    value={modelContentModes}
                    onChange={e => setModelContentModes(e.target.value)}
                    rows={4}
                    placeholder={"e.g.\nanthropic/claude-3.5-sonnet: general, mature\ndeepseek/deepseek-chat: general, mature, explicit"}
                    className="w-full resize-y rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-xs text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                  />
                </div>
              </section>

            </div>
          )}
        </div>

        {/* Sticky footer -- inline padding to bypass Tailwind purge */}
        <div className="shrink-0 border-t border-[#1e1e4a]" style={{ padding: "1rem 1.5rem" }}>
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
      className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[#0d0d2b] ${
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
          <p className={`truncate text-xs ${isSelected ? "text-indigo-300 font-medium" : "text-[#f0f0f5]"}`}>
            {model.name}
          </p>
          {note && (
            <p className="text-xs text-[#8888aa]">{note}</p>
          )}
        </div>
        <span className={`ml-auto shrink-0 text-xs ${model.is_free ? "text-emerald-500" : "text-[#3f3f7a]"}`}>
          {costLabel}
        </span>
      </button>

      {/* Star toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
        className={`shrink-0 transition-colors ${
          isStarred ? "text-amber-400" : "text-[#2a2a4a] hover:text-[#8888aa]"
        }`}
        title={isStarred ? "Remove from favorites" : "Add to favorites"}
      >
        <Star size={13} fill={isStarred ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
