// ProjectSettings.tsx -- The "Book Details" Modal
// =================================================
// Separate from the global Settings modal (API key, model picker).
// Opened from the BOOK DETAILS section at the top of the left nav (the old
// gear icon next to the project title was removed -- this modal is the one
// home for everything book-level). It shows and edits the project.json
// values for the currently open project: title, description, the story
// facts that feed AI prompts (genre, tone, theme, setting, POV, tense,
// audience), the word-count target (stored in the outline frontmatter, not
// project.json), content mode, and the model tier/picker.
//
// Includes the dynamic Model Help Guide that changes text based on
// the writer's current settings -- educating novice writers on how
// model choices affect quality and cost.

import { useState, useEffect } from "react";
import { X, ChevronDown, HelpCircle } from "lucide-react";
import type { ProjectInfo, OutlineTemplateType } from "../types/project";
import type { ModelInfo } from "../types/ai";
// Content-mode filter, cost tiers, media filter, and the curated recommended
// list are shared with the global Settings screen so the two pickers behave
// identically (see utils/modelFiltering.ts).
import {
  filterModelByContentMode, RECOMMENDED_MODELS,
  modelPassesTier, modelIsTextOnly,
} from "../utils/modelFiltering";

const API_BASE = "http://localhost:8000";

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

// Display labels for the four tier stops. The stored values are frozen (they
// live in project.json on user machines); only labels may change. Kept in the
// same order and naming as TIERS in utils/modelFiltering.ts.
const TIER_LABELS: Record<string, string> = {
  free:     "Free",
  budget:   "Lowest",
  standard: "Pricier",
  premium:  "Priority Best",
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
  // Story facts added with the Book Details rework. All of these (plus
  // genre/tone above) are auto-injected into AI prompts as STORY CONTEXT.
  const [theme, setTheme]                     = useState("");
  const [storySetting, setStorySetting]       = useState("");   // "setting" clashes with React naming habits
  const [pointOfView, setPointOfView]         = useState("");
  const [tense, setTense]                     = useState("");
  const [targetAudience, setTargetAudience]   = useState("");
  // Word Count target -- kept as a string for the input; parsed on save.
  // The backend stores it in notes/outline.md frontmatter (the Progress
  // gauge's source of truth), never in project.json.
  const [targetWordCount, setTargetWordCount] = useState("");
  const [contentMode, setContentMode] = useState(project.content_mode_default);
  const [costTier, setCostTier]       = useState("standard");
  const [projectModel, setProjectModel] = useState(project.default_model ?? "");

  // Model list for the per-project picker
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Global text-only preference -- the media-capability filter applies to this
  // picker too so image/video output models stay out of a writing app's list.
  const [textOnlyFilter, setTextOnlyFilter] = useState(true);

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
          setTheme(data.theme ?? "");
          setStorySetting(data.setting ?? "");
          setPointOfView(data.point_of_view ?? "");
          setTense(data.tense ?? "");
          setTargetAudience(data.target_audience ?? "");
          setTargetWordCount(
            data.target_word_count != null ? String(data.target_word_count) : ""
          );
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
    async function loadGlobalFilters() {
      // Only the text-only preference is needed here; everything else in the
      // global settings payload is irrelevant to this modal.
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (res.ok) {
          const data = await res.json();
          setTextOnlyFilter(data.text_only_filter ?? true);
        }
      } catch { /* default stays on */ }
    }
    loadProjectSettings();
    loadModels();
    loadGlobalFilters();
  }, [project.root_path]);


  // --- Save ---
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    // Word Count target: only sent when it parses as a positive number.
    // Blank = leave the outline's value alone (never zero it by accident).
    const parsedTarget = parseInt(targetWordCount.replace(/[,\s]/g, ""), 10);
    if (targetWordCount.trim() !== "" && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
      setError("Word Count target must be a number.");
      setSaving(false);
      return;
    }

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
          theme:                theme,
          setting:              storySetting,
          point_of_view:        pointOfView,
          tense:                tense,
          target_audience:      targetAudience,
          ...(targetWordCount.trim() !== "" ? { target_word_count: parsedTarget } : {}),
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

      // Notify parent so the in-memory project matches what we just saved.
      // IMPORTANT: default_model MUST be included here. App.tsx sends
      // currentProject.default_model on every AI request (App.tsx:~1114). If we
      // leave it out, the spread of the OLD `project` keeps the stale model in
      // memory, so a model change silently has no effect until the writer fully
      // reopens the project -- which looks exactly like "saving didn't work".
      onProjectUpdated({
        ...project,
        title: data.title ?? project.title,
        description: data.description ?? project.description,
        content_mode_default: data.content_mode_default ?? project.content_mode_default,
        default_model: data.default_model ?? null,
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
      return "Consider raising your tier to Lowest. The improvement in AI output quality for explicit content is significant, and the cost is minimal ($0.30-0.80 to get started).";
    }
    if (contentMode === "explicit" && costTier === "budget") {
      return "The Lowest paid tier is a solid choice for explicit fiction. You will see noticeably better character voice and scene quality compared to free models.";
    }
    if (contentMode === "explicit" && (costTier === "standard" || costTier === "premium")) {
      return "Good choice for explicit fiction. Pricier and Priority Best models produce the most natural output for character-driven adult content.";
    }
    if (contentMode === "mature" && costTier === "free") {
      return "Free models handle most mature content, but may occasionally soften or refuse darker scenes. The Lowest paid tier eliminates this limitation.";
    }
    if (costTier === "free") {
      return "This setup works well for getting started. You can always raise the tier later if you want more detailed or nuanced AI feedback.";
    }
    if (costTier === "premium") {
      return "Priority Best gives you access to the most capable models. Best for writers who want the highest quality AI feedback and are comfortable with higher costs.";
    }
    return "This is a balanced setup. Good quality AI feedback at a reasonable cost.";
  }


  // ── Derived: model-picker options ──────────────────────────────────────────
  // The models list comes live from OpenRouter, so a model the project saved
  // earlier can vanish from it -- the provider deprecated/renamed it, or the
  // content-mode filter now hides it. When that happens a plain <select> can't
  // display the stored value (no matching <option>), so it silently shows the
  // FIRST option instead. That tricked a writer into thinking their model was
  // fine and re-saving the stale, dead model on a blind Save. To prevent that
  // we detect the orphaned value and render an explicit option for it, clearly
  // flagged as unavailable, plus a warning nudging them to pick a current one.
  // Candidate models for this project: content-mode compatible, within the
  // project's cost tier, and (if the global preference is on) text-output only.
  // This is where the project's cost tier actually filters candidates -- the
  // tier is enforced at pick time rather than at request time because model
  // prices only exist in the live OpenRouter list, not on the backend.
  const visibleModels = models.filter(m =>
    filterModelByContentMode(m, contentMode)
    && modelPassesTier(m, costTier)
    && (!textOnlyFilter || modelIsTextOnly(m))
  );
  const projectModelInList =
    projectModel !== "" && visibleModels.some(m => m.id === projectModel);
  const projectModelMissing = projectModel !== "" && !projectModelInList;

  // Recommended models that exist in the live list AND pass the content-mode
  // filter -- pinned in their own <optgroup> at the top of the picker. Same
  // curated list and live-list cross-check the global Settings screen uses, so
  // a deprecated recommendation never appears here either.
  const recommendedOptions = RECOMMENDED_MODELS.filter(rec =>
    visibleModels.some(m => m.id === rec.id)
  );

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
          <h2 className="text-base font-semibold text-text-primary">Book Details</h2>
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

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Theme</label>
                <p className="mb-1 text-xs text-faint">
                  The idea the story keeps returning to. Auto-injected into AI prompts.
                </p>
                <input
                  type="text"
                  value={theme}
                  onChange={e => setTheme(e.target.value)}
                  placeholder="e.g. redemption, found family, the cost of power"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Setting</label>
                <p className="mb-1 text-xs text-faint">
                  Where and when the story happens. Auto-injected into AI prompts.
                </p>
                <input
                  type="text"
                  value={storySetting}
                  onChange={e => setStorySetting(e.target.value)}
                  placeholder="e.g. a storm-locked island kingdom, near-future Chicago"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Word Count Target</label>
                <p className="mb-1 text-xs text-faint">
                  Target length in words. Drives the Writing Progress gauge
                  (stored in the outline, not project settings). Leave blank to keep the current target.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={targetWordCount}
                  onChange={e => setTargetWordCount(e.target.value)}
                  placeholder="e.g. 90000"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                />
              </div>

              {/* POV and Tense side by side -- both are short pick-lists */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">Point of View</label>
                  <select
                    value={pointOfView}
                    onChange={e => setPointOfView(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                    title="Narration perspective. Auto-injected into AI prompts."
                  >
                    <option value="">(not set)</option>
                    <option value="First">First</option>
                    <option value="Second">Second</option>
                    <option value="Third Limited">Third Limited</option>
                    <option value="Third Omniscient">Third Omniscient</option>
                    <option value="Multiple">Multiple</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">Tense</label>
                  <select
                    value={tense}
                    onChange={e => setTense(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                    title="Narration tense. Auto-injected into AI prompts."
                  >
                    <option value="">(not set)</option>
                    <option value="Past">Past</option>
                    <option value="Present">Present</option>
                  </select>
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Target Audience</label>
                <p className="mb-1 text-xs text-faint">
                  Who the book is for. Auto-injected into AI prompts.
                </p>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={e => setTargetAudience(e.target.value)}
                  placeholder="e.g. Adult, Young Adult, Middle Grade"
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

              {/* Model Cost Tier */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Model Cost Tier</label>
                <p className="mb-2 text-xs text-faint">
                  Caps how expensive the models offered in this project's picker are.
                  Also drives the cost guidance below.
                </p>
                <select
                  value={costTier}
                  onChange={e => setCostTier(e.target.value)}
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
                >
                  <option value="free">Free (free models only)</option>
                  <option value="budget">Lowest ($0-1/M input)</option>
                  <option value="standard">Pricier ($1-15/M input)</option>
                  <option value="premium">Priority Best (all models)</option>
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
                    {/* Orphaned stored model: render it so the select shows the
                        TRUE saved value instead of snapping to the first option.
                        Flagged so the writer knows it must be replaced. */}
                    {projectModelMissing && (
                      <option value={projectModel}>
                        {projectModel} (unavailable -- select a current model)
                      </option>
                    )}
                    {/* Recommended group, pinned at the top. Curated + cross-checked
                        against the live list, so no deprecated slugs appear. */}
                    {recommendedOptions.length > 0 && (
                      <optgroup label="★ Recommended">
                        {recommendedOptions.map(rec => {
                          const m = visibleModels.find(vm => vm.id === rec.id)!;
                          return (
                            <option key={`rec-${rec.id}`} value={rec.id}>
                              {m.name} -- {rec.note}
                              {m.is_free ? " (free)" : ` ($${m.cost_input_per_million.toFixed(2)}/M)`}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {/* All models (recommended ones are repeated here too, under
                        their natural list, which is fine for a dropdown). */}
                    <optgroup label="All models">
                      {visibleModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.is_free ? " (free)" : ` ($${m.cost_input_per_million.toFixed(2)}/M)`}
                        </option>
                      ))}
                    </optgroup>
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
                {/* Loud warning when the saved model is no longer selectable.
                    This is the case that produced the silent "HTTP 404" -- the
                    model is dead but the project still points at it. */}
                {projectModelMissing && models.length > 0 && (
                  <p className="mt-1 text-xs text-amber-500">
                    This project is set to <span className="font-mono">{projectModel}</span>, which
                    is not in the current model list. If the provider deprecated or renamed it, AI
                    requests will fail until you pick a current model above. If it is only hidden by
                    this project's content mode, cost tier, or the text-only filter, requests still
                    work, but consider picking a model that fits your filters.
                  </p>
                )}
                {projectModel && !projectModelMissing && (
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
