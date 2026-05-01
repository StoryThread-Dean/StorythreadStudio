// ProjectSettings.tsx -- Project-Level Settings Modal
// =====================================================
// Separate from the global Settings modal (API key, model picker).
// This shows and edits the project.json values for the currently open project:
// title, description, content mode, model tier floor.
//
// Includes the dynamic Model Help Guide that changes text based on
// the writer's current settings -- educating novice writers on how
// model choices affect quality and cost.

import { useState, useEffect } from "react";
import { X, ChevronDown, HelpCircle } from "lucide-react";
import type { ProjectInfo, OutlineTemplateType } from "../types/project";
import type { ModelInfo } from "../types/ai";

const API_BASE = "http://localhost:8000";

// ── Content Mode Model Filtering ──────────────────────────────────────────────
// OpenRouter's is_moderated flag is unreliable. Instead, we use two approaches:
//
// MATURE mode: blacklist known strict providers (hides ~50 models)
// EXPLICIT mode: whitelist known unmoderated providers (shows only ~50-80 models)
//
// The whitelist approach for explicit is more aggressive but more accurate.
// Writers can still type any model ID manually if they know a specific model works.
// These lists should be reviewed periodically as providers change.
//
// Sources: NovelCrafter NSFW docs, OpenRouter roleplay collection, community reports.

const MODERATED_PROVIDERS = [
  "openai/",
  "anthropic/",
  "google/",
  "cohere/",
];

// Providers known to allow explicit/NSFW content without content filtering.
// Used for explicit mode whitelist -- only these providers are shown.
const EXPLICIT_ALLOWED_PROVIDERS = [
  "mistralai/",          // Mistral models (most are unmoderated)
  "deepseek/",           // DeepSeek models
  "x-ai/",              // Grok (known for explicit prose)
  "meta-llama/",         // Llama models (open source, unmoderated)
  "qwen/",              // Qwen models
  "nothingiisreal/",    // NiR creative writing models
  "nousresearch/",      // Nous Research models
  "cognitivecomputations/", // Cognitive Computations (Dolphin etc.)
  "thedrummer/",        // TheDrummer creative models
  "sao10k/",            // Sao10K models
  "anthracite-org/",    // Anthracite models
  "venice/",            // Venice AI (explicitly uncensored)
  "eva-unit-01/",       // Eva models
  "microsoft/",         // Phi models (generally unmoderated)
  "01-ai/",             // Yi models
  "liquid/",            // Liquid AI
  "ai21/",              // AI21 (generally permissive)
];

function filterModelByContentMode(m: ModelInfo, contentMode: string): boolean {
  if (contentMode === "general") return true;

  if (contentMode === "mature") {
    // Mature: hide known strict providers
    if (m.is_moderated) return false;
    return !MODERATED_PROVIDERS.some(prefix => m.id.startsWith(prefix));
  }

  if (contentMode === "explicit") {
    // Explicit: whitelist only -- show ONLY known unmoderated providers
    return EXPLICIT_ALLOWED_PROVIDERS.some(prefix => m.id.startsWith(prefix));
  }

  return true;
}

// ── Cost estimate ranges per tier ─────────────────────────────────────────────
// These are high-level educational estimates, not exact prices.
// "startup" = building 5-8 profiles + world-building + writing 3-5 chapters with AI
// "session" = typical 2-3 hour writing session (profile tweaks + 1-2 chapters feedback)
const COST_ESTIMATES: Record<string, { startup: string; session: string }> = {
  free:     { startup: "$0",              session: "$0" },
  budget:   { startup: "$0.30 - $0.80",   session: "$0.05 - $0.15" },
  standard: { startup: "$0.80 - $2.50",   session: "$0.15 - $0.40" },
  premium:  { startup: "$2.00 - $6.00",   session: "$0.40 - $1.00" },
};

const TIER_LABELS: Record<string, string> = {
  free:     "Free Only",
  budget:   "Budget",
  standard: "Standard",
  premium:  "Premium",
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface ProjectSettingsProps {
  project: ProjectInfo;
  onClose: () => void;
  onProjectUpdated: (updated: ProjectInfo) => void;
}


// ── ProjectSettings Component ─────────────────────────────────────────────────
export function ProjectSettings({ project, onClose, onProjectUpdated }: ProjectSettingsProps) {

  // Editable fields (initialized from current project)
  const [title, setTitle]             = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [genre, setGenre]             = useState("");
  const [tone, setTone]               = useState("");
  const [contentMode, setContentMode] = useState(project.content_mode_default);
  const [costTier, setCostTier]       = useState("standard");
  const [projectModel, setProjectModel] = useState(project.default_model ?? "");

  // Model list for the per-project picker
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Outline template section -- tracks the current template and lets the writer
  // swap it. The initial value comes from project.json (may be null for older
  // projects created before templates existed).
  const [templateChoice, setTemplateChoice] = useState<OutlineTemplateType>(
    project.outline_template ?? "novel"
  );
  const [templateApplying, setTemplateApplying] = useState(false);
  const [templateApplied, setTemplateApplied]   = useState(false);
  // True after the writer changes the radio, before they click Apply.
  // Prevents flashing "Applied!" from a previous run.
  const templateDirty = templateChoice !== (project.outline_template ?? "novel");

  // Help guide expanded state
  const [showGuide, setShowGuide] = useState(false);

  // UI state
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Load full project.json + model list on mount
  useEffect(() => {
    async function loadProjectSettings() {
      try {
        const params = new URLSearchParams({ root_path: project.root_path });
        const res = await fetch(`${API_BASE}/api/projects/settings?${params}`);
        if (res.ok) {
          const data = await res.json();
          setGenre(data.genre ?? "");
          setTone(data.tone ?? "");
          setCostTier(data.cost_tier ?? "standard");
          setProjectModel(data.default_model ?? "");
        }
      } catch { /* use defaults */ }
    }
    async function loadModels() {
      try {
        const res = await fetch(`${API_BASE}/api/ai/models`);
        if (res.ok) {
          const data: ModelInfo[] = await res.json();
          setModels(data);
        }
      } catch { /* models optional */ }
    }
    loadProjectSettings();
    loadModels();
  }, [project.root_path]);


  // --- Save ---
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/projects/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root_path:            project.root_path,
          title:                title.trim() || project.title,
          description:          description,
          genre:                genre,
          tone:                 tone,
          content_mode_default: contentMode,
          cost_tier:            costTier,
          default_model:        projectModel || null,  // empty string = use global
        }),
      });

      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? "Save failed.");
      }

      const data = await res.json();
      setSaved(true);

      // Notify parent so the sidebar title updates
      onProjectUpdated({
        ...project,
        title: data.title ?? project.title,
        description: data.description ?? project.description,
        content_mode_default: data.content_mode_default ?? project.content_mode_default,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }


  // --- Apply outline template ---
  // Regenerates notes/outline.md with the selected template. This is a
  // separate action from Save because it overwrites a file -- the writer
  // must explicitly confirm it.
  async function handleApplyTemplate() {
    setTemplateApplying(true);
    setTemplateApplied(false);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/projects/apply-outline-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root_path:     project.root_path,
          template_type: templateChoice,
        }),
      });

      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? "Failed to apply template.");
      }

      setTemplateApplied(true);
      // Update the parent's project info so outline_template stays in sync.
      onProjectUpdated({
        ...project,
        outline_template: templateChoice,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply template.");
    } finally {
      setTemplateApplying(false);
    }
  }


  // ── Dynamic guide text generators ────────────────────────────────────────
  const costs = COST_ESTIMATES[costTier] ?? COST_ESTIMATES.standard;
  const tierLabel = TIER_LABELS[costTier] ?? "Standard";

  function getContentModeGuide(): string {
    if (contentMode === "explicit") {
      return "Free models like Mistral and Gemma can technically handle explicit content, but many writers find their output formulaic and limited, particularly for dialogue, character voice, and intimate scenes. Budget models ($0.50-1/M) produce noticeably better results. Standard models ($1-15/M) offer the most natural, character-aware output for this content type. The difference is most apparent in scenes that require emotional nuance alongside explicit content.";
    }
    if (contentMode === "mature") {
      return "Mature content (violence, dark themes, non-explicit adult content) is supported by most models at budget tier and above. Free models may occasionally refuse or soften certain scenes.";
    }
    return "Most AI models handle general fiction well. You have the widest selection at every price tier.";
  }

  function getRecommendation(): string {
    if (contentMode === "explicit" && costTier === "free") {
      return "Consider raising your tier floor to Budget. The improvement in AI output quality for explicit content is significant, and the cost is minimal ($0.30-0.80 to get started).";
    }
    if (contentMode === "explicit" && costTier === "budget") {
      return "Budget tier is a solid choice for explicit fiction. You will see noticeably better character voice and scene quality compared to free models.";
    }
    if (contentMode === "explicit" && (costTier === "standard" || costTier === "premium")) {
      return "Good choice for explicit fiction. Standard and premium models produce the most natural output for character-driven adult content.";
    }
    if (contentMode === "mature" && costTier === "free") {
      return "Free models handle most mature content, but may occasionally soften or refuse darker scenes. Budget tier eliminates this limitation.";
    }
    if (costTier === "free") {
      return "This setup works well for getting started. You can always raise the tier later if you want more detailed or nuanced AI feedback.";
    }
    if (costTier === "premium") {
      return "Premium tier gives you access to the most capable models. Best for writers who want the highest quality AI feedback and are comfortable with higher costs.";
    }
    return "This is a balanced setup. Good quality AI feedback at a reasonable cost.";
  }


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-bg-panel shadow-2xl">

        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-border"
          style={{ padding: "1rem 1.5rem" }}
        >
          <h2 className="text-base font-semibold text-text-primary">Project Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "1.25rem 1.5rem" }}>
          <div className="space-y-6">

            {/* ── Project Info ──────────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Project Info
              </h3>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Genre</label>
                <p className="mb-1 text-xs text-faint">
                  Auto-injected into AI prompts as story context.
                </p>
                <input
                  type="text"
                  value={genre}
                  onChange={e => setGenre(e.target.value)}
                  placeholder="e.g. epic fantasy, sci-fi thriller, contemporary romance"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Tone</label>
                <p className="mb-1 text-xs text-faint">
                  Auto-injected into AI prompts as story context.
                </p>
                <input
                  type="text"
                  value={tone}
                  onChange={e => setTone(e.target.value)}
                  placeholder="e.g. dark, atmospheric, slow burn, humorous"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                />
              </div>

              {/* Series info (read-only if applicable) */}
              {project.series_id && (
                <div className="rounded border border-teal-800/40 bg-teal-950/20 p-3">
                  <p className="text-xs text-teal-400">
                    Part of a series
                  </p>
                  <p className="text-xs text-text-muted">
                    Series path: {project.series_path}
                  </p>
                </div>
              )}
            </section>


            {/* ── Outline Template ─────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Outline Template
              </h3>
              <p className="mb-3 text-xs text-faint">
                Choose which scaffold to use for notes/outline.md. Applying a
                new template will <span className="text-amber-500">overwrite</span> the
                current outline file.
              </p>

              {/* Template radio options */}
              <div className="mb-3 flex flex-col gap-1.5">
                {([
                  { value: "novel" as OutlineTemplateType, label: "Novel", hint: "Full three-act scaffold for fiction and fantasy novels." },
                  { value: "short_story" as OutlineTemplateType, label: "Short Story", hint: "Tight 2k-10k scaffold with Seven-Point, Freytag, and more." },
                ]).map(opt => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-start gap-2 rounded border border-border bg-bg-surface p-2 transition-colors hover:border-faint"
                  >
                    <input
                      type="radio"
                      name="outlineTemplate"
                      value={opt.value}
                      checked={templateChoice === opt.value}
                      onChange={() => { setTemplateChoice(opt.value); setTemplateApplied(false); }}
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <p className="text-xs font-medium text-text-primary">{opt.label}</p>
                      <p className="text-xs text-text-muted">{opt.hint}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Apply button + warning -- only shown when the choice differs from
                  the currently applied template */}
              {templateDirty && (
                <div className="mb-2 rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2">
                  <p className="text-xs text-amber-400">
                    Applying will replace the current outline.md. This cannot be undone.
                  </p>
                </div>
              )}

              <button
                onClick={handleApplyTemplate}
                disabled={templateApplying || (!templateDirty && !templateApplied)}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {templateApplying ? "Applying..." : "Apply Template"}
              </button>

              {templateApplied && !templateDirty && (
                <span className="ml-2 text-xs text-emerald-400">Template applied.</span>
              )}
            </section>


            {/* ── Content & Models ──────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Content & Models
              </h3>

              {/* Content Mode */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Content Mode</label>
                <p className="mb-2 text-xs text-faint">
                  Controls how AI assistants handle mature or explicit story content for this project.
                </p>
                <div className="flex flex-col gap-2">
                  {[
                    { value: "general",  label: "General",  desc: "Standard fiction" },
                    { value: "mature",   label: "Mature",   desc: "Violence, dark themes, non-explicit adult" },
                    { value: "explicit", label: "Explicit", desc: "Adult fiction with explicit content" },
                  ].map(opt => (
                    <label key={opt.value} className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="contentMode"
                        value={opt.value}
                        checked={contentMode === opt.value}
                        onChange={() => setContentMode(opt.value)}
                        className="mt-0.5 accent-indigo-500"
                      />
                      <div>
                        <span className="text-xs font-medium text-text-primary">{opt.label}</span>
                        <span className="ml-2 text-xs text-faint">{opt.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Model Tier Floor */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Model Quality Floor</label>
                <p className="mb-2 text-xs text-faint">
                  Sets the minimum AI model quality for this project. If blank, the global setting is used.
                </p>
                <select
                  value={costTier}
                  onChange={e => setCostTier(e.target.value)}
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                >
                  <option value="free">Free Only</option>
                  <option value="budget">Budget ($0-1/M input)</option>
                  <option value="standard">Standard ($1-15/M input)</option>
                  <option value="premium">Premium (all models)</option>
                </select>
              </div>

              {/* Per-Project Model Selection
                  Auto-filtered by content mode:
                  - General: all models shown
                  - Mature: all models shown (most handle mature content)
                  - Explicit: only unmoderated models shown (moderated ones refuse explicit)
              */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Project Model</label>
                <p className="mb-2 text-xs text-faint">
                  Choose a specific model for this project. Leave blank to use the global default.
                  {contentMode === "explicit" && (
                    <span className="ml-1 text-amber-500">
                      Showing only unmoderated models (explicit mode).
                    </span>
                  )}
                  {contentMode === "mature" && (
                    <span className="ml-1 text-amber-500">
                      Hiding known moderated providers (mature mode).
                    </span>
                  )}
                </p>
                {models.length > 0 ? (
                  <select
                    value={projectModel}
                    onChange={e => setProjectModel(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                  >
                    <option value="">Use global default</option>
                    {models
                      .filter(m => filterModelByContentMode(m, contentMode))
                      .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.is_free ? " (free)" : ` ($${m.cost_input_per_million.toFixed(2)}/M)`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={projectModel}
                    onChange={e => setProjectModel(e.target.value)}
                    placeholder="e.g. anthropic/claude-3.5-sonnet (leave blank for global)"
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                  />
                )}
                {projectModel && (
                  <p className="mt-1 text-xs text-emerald-600">
                    This project will use {projectModel.split("/").pop()} for all AI requests.
                  </p>
                )}
              </div>
            </section>


            {/* ── Help Guide (expandable) ───────────────────────────────── */}
            <section>
              <button
                onClick={() => setShowGuide(g => !g)}
                className="flex w-full items-center justify-between rounded border border-border bg-bg-primary px-4 py-3 text-left transition-colors hover:border-indigo-800"
              >
                <div className="flex items-center gap-2">
                  <HelpCircle size={14} className="text-indigo-400" />
                  <span className="text-xs font-semibold text-text-primary">
                    Model Choosing Guide
                  </span>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-text-muted transition-transform ${showGuide ? "rotate-180" : ""}`}
                />
              </button>

              {showGuide && (
                <div className="mt-2 space-y-4 rounded border border-border bg-bg-primary p-4">

                  {/* Section A: What does the tier floor do? */}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-indigo-300">
                      What does the model quality floor do?
                    </p>
                    <p className="text-xs leading-relaxed text-text-muted">
                      The quality floor sets the minimum capability level for AI assistance
                      in this project. Free models are available to everyone at no cost.
                      Budget and Standard models produce more nuanced, character-aware
                      results but cost money per use through your OpenRouter account.
                    </p>
                  </div>

                  {/* Section B: Cost estimates (dynamic based on tier) */}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-indigo-300">
                      What will this cost me?
                    </p>
                    <p className="mb-1 text-xs text-text-muted">
                      At the <span className="font-medium text-text-primary">{tierLabel}</span> tier:
                    </p>
                    <div className="rounded border border-border bg-bg-panel p-3">
                      <p className="text-xs text-text-primary">
                        Getting started (5-8 profiles, world-building, 3-5 chapters with AI feedback):
                        <span className="ml-1 font-semibold text-emerald-400">{costs.startup}</span>
                      </p>
                      <p className="mt-1 text-xs text-text-primary">
                        Typical writing session after that (profile tweaks, feedback on 1-2 chapters):
                        <span className="ml-1 font-semibold text-emerald-400">{costs.session}</span>
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-faint">
                      These are rough estimates. Actual costs depend on the specific model,
                      how much text you send, and how often you use AI features.
                    </p>
                  </div>

                  {/* Section C: Content mode impact (dynamic) */}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-indigo-300">
                      How does content mode affect model choice?
                    </p>
                    <p className="text-xs leading-relaxed text-text-muted">
                      {getContentModeGuide()}
                    </p>
                  </div>

                  {/* Section D: Recommendation (dynamic based on ALL settings) */}
                  <div className="rounded border border-indigo-800/40 bg-indigo-950/20 p-3">
                    <p className="mb-1 text-xs font-semibold text-indigo-300">
                      Recommendation for your project
                    </p>
                    <p className="text-xs leading-relaxed text-text-primary">
                      {getRecommendation()}
                    </p>
                  </div>

                </div>
              )}
            </section>

          </div>
        </div>

        {/* Footer */}
        <div
          className="shrink-0 border-t border-border"
          style={{ padding: "1rem 1.5rem" }}
        >
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          {saved && !error && (
            <p className="mb-2 text-xs text-emerald-400">Settings saved.</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
