// Settings.tsx -- Settings Modal
// ================================
// A modal overlay for configuring the OpenRouter API key and default model.
// Triggered by the Settings button in the editor's left nav.
//
// This is a modal (overlay) rather than a full screen because the writer
// may want to quickly check or change a setting without losing their place
// in the editor.

import { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle, XCircle, Loader } from "lucide-react";
import type { AppSettings, ModelInfo } from "../types/ai";

const API_BASE = "http://localhost:8000";

// ── Props ────────────────────────────────────────────────────────────────────
interface SettingsProps {
  onClose: () => void;
}

// ── Settings Component ───────────────────────────────────────────────────────
export function Settings({ onClose }: SettingsProps) {
  // Current settings loaded from backend
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // The API key the user is typing (separate from the saved/masked key)
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey]         = useState(false);

  // Model list (fetched from OpenRouter once the key is saved)
  const [models, setModels]           = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  // UI state
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [testing, setTesting]         = useState(false);
  const [testResult, setTestResult]   = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [saved, setSaved]             = useState(false);


  // --- Load settings and model list on mount ---
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (!res.ok) throw new Error("Could not load settings.");
        const data: AppSettings = await res.json();
        setSettings(data);
        setSelectedModel(data.default_model);

        // Try to fetch models if a key is saved
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
  async function fetchModels() {
    try {
      const res = await fetch(`${API_BASE}/api/ai/models`);
      if (!res.ok) return;  // Silently fail -- models are optional for the UI
      const data: ModelInfo[] = await res.json();
      setModels(data);
    } catch {
      // Not critical -- user can still save settings without a model list
    }
  }


  // --- Save settings ---
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const payload: Record<string, string> = {
        default_model: selectedModel,
      };

      // Only send the API key if the user typed something
      // (blank input = keep the existing key)
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
      setApiKeyInput("");  // Clear the input after saving
      setSaved(true);
      setTestResult(null);

      // Refresh the model list now that the key may have changed
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

    // If there's an unsaved key in the input, save it first
    if (apiKeyInput.trim()) {
      await handleSave();
    }

    try {
      const res = await fetch(`${API_BASE}/api/settings/test-connection`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.ok) {
        setTestResult({
          ok: true,
          message: `Connected. ${data.model_count} models available.`,
        });
        fetchModels();  // Refresh models on successful test
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
    // Modal backdrop -- clicking outside closes the modal
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] p-6 shadow-2xl">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#f0f0f5]">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-[#f0f0f5]"
            title="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[#8888aa]">Loading settings...</p>
        ) : (
          <div className="space-y-5">

            {/* OpenRouter API Key */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                OpenRouter API Key
              </label>
              <p className="mb-2 text-xs text-[#3f3f7a]">
                {settings?.openrouter_api_key_set
                  ? `Current key: ${settings.openrouter_api_key} (enter a new key to replace it)`
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

              {/* Connection test result */}
              {testResult && (
                <div className={`mt-2 flex items-center gap-2 text-xs ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {testResult.ok
                    ? <CheckCircle size={13} />
                    : <XCircle size={13} />
                  }
                  {testResult.message}
                </div>
              )}
            </div>

            {/* Default Model */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                Default Model
              </label>
              <p className="mb-2 text-xs text-[#3f3f7a]">
                Used for all writing assistants unless overridden per-request.
              </p>
              {models.length > 0 ? (
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] outline-none focus:border-indigo-500"
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.cost_input_per_million > 0
                        ? ` ($${m.cost_input_per_million.toFixed(2)}/M in)`
                        : " (free)"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  placeholder="e.g. openai/gpt-4o-mini"
                  className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                />
              )}
              <p className="mt-1 text-xs text-[#3f3f7a]">
                Test your connection above to load the model list.
              </p>
            </div>

            {/* Error and saved feedback */}
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            {saved && !error && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle size={13} /> Settings saved.
              </p>
            )}

            {/* Save button */}
            <div className="flex justify-end pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
