// ProjectCompletionGauge.tsx
// =====================================================================
// The v1.0.2 Writing Progress gauge. Lives in the left panel, below the
// project title and above the Chapters/Notes/Profiles navigation. Two modes:
//
//   - Compact: a clickable horizontal bar showing X% and the manuscript
//     word count. Always rendered.
//   - Expanded: a slide-over panel (absolutely-positioned inside the aside
//     so it never crosses into the editor area) showing the per-segment
//     breakdown, today's daily-goal status, the task credit list, and a
//     7-day hit/miss sparkline.
//
// Two fetches power it:
//   GET /api/progress/summary  -- the gauge math
//   GET /api/progress/daily    -- today's words/tasks/sparkline
//
// Both refetch when the slide-over opens, so the writer always sees fresh
// data when they go looking. The compact bar uses the same summary fetch
// and refreshes on mount + when the projectPath changes.
//
// Serial fiction: the gauge renders a placeholder card explaining that the
// model for serial fiction is still being designed. Daily tracking still
// works for serials -- it's the project-completion percentage that doesn't
// apply yet.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type {
  ProgressSummary,
  ProgressDaily,
  TaskCreditEntry,
  DailySparklineCell,
} from "../../types/progress";


const API_BASE = "http://localhost:8000";


interface Props {
  projectPath: string;
  // Lifted state lets App.tsx coordinate the slide-over with other left-panel
  // overlays (project switcher, settings menu) if needed later.
  isOpen:      boolean;
  onToggle:    () => void;
}


export function ProjectCompletionGauge({ projectPath, isOpen, onToggle }: Props) {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [daily,   setDaily]   = useState<ProgressDaily   | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Fetch summary + daily for the current project. Best-effort: if the
  // backend isn't running yet or app.db hasn't been written to, both return
  // empty defaults from the server side; we just surface "..." in the bar.
  const fetchProgress = useCallback(async () => {
    if (!projectPath) return;
    try {
      const [sRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/api/progress/summary?project_path=${encodeURIComponent(projectPath)}`),
        fetch(`${API_BASE}/api/progress/daily?project_path=${encodeURIComponent(projectPath)}`),
      ]);
      if (sRes.ok) setSummary(await sRes.json());
      if (dRes.ok) setDaily(await dRes.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load progress.");
    }
  }, [projectPath]);

  // Mount + projectPath change -> initial fetch.
  useEffect(() => {
    void fetchProgress();
  }, [fetchProgress]);

  // Open the slide-over -> refetch so the writer always sees fresh numbers.
  useEffect(() => {
    if (isOpen) void fetchProgress();
  }, [isOpen, fetchProgress]);


  // ── Compact bar ──────────────────────────────────────────────────────────

  const percent = summary?.percent ?? 0;
  const isSerial = summary?.is_serial ?? false;

  return (
    <div className="relative">
      {/* The clickable compact bar. Always rendered. Click to toggle the
          slide-over below. */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-1 rounded border border-border bg-bg-panel px-3 py-2 text-left transition-colors hover:border-indigo-500"
        title={isSerial
          ? "Writing Progress for serial fiction is being designed"
          : "Click to expand the project completion breakdown"}
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-text-primary">Progress</span>
          {isSerial ? (
            <span className="text-text-muted">serial</span>
          ) : (
            <span className="text-text-muted">{percent.toFixed(0)}%</span>
          )}
        </div>
        {/* The bar. For serial fiction we render a striped placeholder
            since the percentage doesn't apply. */}
        <div className="h-1.5 w-full overflow-hidden rounded bg-bg-surface">
          {isSerial ? (
            <div
              className="h-full w-full"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, var(--color-bg-surface) 0 4px, var(--color-border) 4px 8px)",
              }}
            />
          ) : (
            <div
              className="h-full rounded bg-indigo-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          )}
        </div>
        {summary && !isSerial && (
          <p className="text-xs text-faint">
            {summary.manuscript.actual_words.toLocaleString()} /{" "}
            {summary.manuscript.target_words
              ? summary.manuscript.target_words.toLocaleString()
              : "?"}{" "}
            words
          </p>
        )}
      </button>

      {/* ── Slide-over panel ─────────────────────────────────────────────
          Absolutely positioned inside the aside (parent has relative
          positioning) so it overlays the Chapters/Notes navigation
          without crossing into the editor area. The panel has its own
          scroll for long breakdowns. */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[80vh] overflow-y-auto rounded border border-border bg-bg-panel shadow-xl"
        >
          <SlideOverHeader onClose={onToggle} />
          {error && (
            <p className="px-3 py-2 text-xs text-rose-400">{error}</p>
          )}
          {isSerial ? (
            <SerialPlaceholder />
          ) : (
            <SummaryBreakdown summary={summary} />
          )}
          <DailyTracker daily={daily} />
        </div>
      )}
    </div>
  );
}


// ── Slide-over header ───────────────────────────────────────────────────────

function SlideOverHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Writing Progress
      </h3>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-1 text-faint transition-colors hover:bg-bg-surface hover:text-text-muted"
        title="Close"
      >
        <X size={12} />
      </button>
    </div>
  );
}


// ── Serial fiction placeholder ──────────────────────────────────────────────

function SerialPlaceholder() {
  return (
    <div className="border-b border-border px-3 py-4">
      <p className="text-xs text-text-primary">Serial fiction</p>
      <p className="mt-1 text-xs text-text-muted">
        Writing Progress for serial fiction is being designed -- feedback
        welcome. Serials are profile-heavy and chapter-self-contained, so the
        percentage model used for other story types doesn't apply yet.
      </p>
      <p className="mt-2 text-xs text-faint">
        Daily tracking (below) still works for serial projects.
      </p>
    </div>
  );
}


// ── Per-segment breakdown ───────────────────────────────────────────────────

function SummaryBreakdown({ summary }: { summary: ProgressSummary | null }) {
  if (!summary) {
    return <p className="px-3 py-2 text-xs text-faint">Loading...</p>;
  }

  return (
    <div className="border-b border-border">
      {/* Manuscript */}
      <SegmentRow
        label="Manuscript"
        weight={summary.manuscript.weight}
        rightLabel={`${summary.manuscript.actual_words.toLocaleString()} / ${
          summary.manuscript.target_words
            ? summary.manuscript.target_words.toLocaleString()
            : "?"
        }`}
        detail={`${summary.manuscript.chapter_count} chapter${
          summary.manuscript.chapter_count === 1 ? "" : "s"
        }`}
      />

      {/* Outline */}
      <SegmentRow
        label="Outline"
        weight={summary.outline.weight}
        rightLabel={
          summary.outline.has_frontmatter
            ? "tracked"
            : summary.outline.present
            ? "no tracking data"
            : "-no entry-"
        }
        detail={
          summary.outline.has_frontmatter
            ? "frontmatter parsed"
            : "Add YAML frontmatter to outline.md for richer tracking"
        }
      />

      {/* Profiles bucket */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-text-primary">Profiles</span>
          <span className="text-text-muted">
            {summary.profiles.weight > 0
              ? `${summary.profiles.weight.toFixed(0)}% weight`
              : "info only"}
          </span>
        </div>
        {summary.profiles.subsegments.map(sub => {
          if (sub.expected === 0 && sub.actual === 0) {
            return (
              <p key={sub.name} className="mt-1 text-xs text-faint">
                {sub.name}: -no entry-
              </p>
            );
          }
          return (
            <div key={sub.name} className="mt-1 text-xs">
              <p className="text-text-muted">
                {sub.name}: {sub.matched_names.length} matched /{" "}
                {sub.expected || sub.actual} expected
                {sub.actual !== sub.matched_names.length &&
                  ` (${sub.actual} files on disk)`}
              </p>
              {sub.unmatched_names.length > 0 && (
                <p className="text-faint">
                  unresolved: {sub.unmatched_names.join(", ")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Notes */}
      <SegmentRow
        label="Notes"
        weight={summary.notes.weight}
        rightLabel={summary.notes.present ? "present" : "-no entry-"}
        detail={
          summary.notes.file_count > 0
            ? `${summary.notes.file_count} file${
                summary.notes.file_count === 1 ? "" : "s"
              } in notes/ (outline excluded)`
            : "No non-outline note files yet"
        }
      />
    </div>
  );
}


function SegmentRow({
  label, weight, rightLabel, detail,
}: {
  label: string; weight: number; rightLabel: string; detail: string;
}) {
  return (
    <div className="border-t border-border px-3 py-2 first:border-t-0">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-text-primary">{label}</span>
        <span className="text-text-muted">{rightLabel}</span>
      </div>
      <p className="text-xs text-faint">
        {weight > 0 ? `${weight.toFixed(0)}% weight - ${detail}` : detail}
      </p>
    </div>
  );
}


// ── Daily tracker + sparkline ───────────────────────────────────────────────

function DailyTracker({ daily }: { daily: ProgressDaily | null }) {
  if (!daily) {
    return <p className="px-3 py-2 text-xs text-faint">Loading today...</p>;
  }

  const goalHit =
    daily.today_words >= daily.word_target &&
    daily.today_tasks.length >= daily.task_target;

  return (
    <div className="px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Today ({daily.skill_level})
        </h4>
        {goalHit && (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
            Goal hit
          </span>
        )}
      </div>

      {/* Words progress */}
      <p className="text-xs">
        <span className="text-text-primary">
          {daily.today_words.toLocaleString()}
        </span>
        <span className="text-text-muted">
          {" "}
          / {daily.word_target.toLocaleString()} words
        </span>
      </p>

      {/* Tasks progress */}
      <p className="mt-1 text-xs">
        <span className="text-text-primary">{daily.today_tasks.length}</span>
        <span className="text-text-muted"> / {daily.task_target} tasks</span>
      </p>

      {/* Task credit list */}
      {daily.today_tasks.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {daily.today_tasks.map(t => (
            <li key={`${t.file_relpath}-${t.reason}`} className="text-xs text-faint">
              <span className="truncate">{shortRelpath(t.file_relpath)}</span>
              <span className="ml-1 text-text-muted">
                ({reasonLabel(t.reason)})
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 7-day sparkline */}
      <div className="mt-3">
        <p className="mb-1 text-xs text-text-muted">Last 7 days</p>
        <div className="flex gap-1">
          {daily.sparkline_7day.map(cell => (
            <SparkCell
              key={cell.local_date}
              cell={cell}
              wordTarget={daily.word_target}
              taskTarget={daily.task_target}
              isToday={cell.local_date === daily.today_local_date}
            />
          ))}
        </div>
      </div>
    </div>
  );
}


function SparkCell({
  cell, wordTarget, taskTarget, isToday,
}: {
  cell: DailySparklineCell;
  wordTarget: number;
  taskTarget: number;
  isToday: boolean;
}) {
  const tooltip =
    `${cell.local_date}: ${cell.words.toLocaleString()} / ${wordTarget.toLocaleString()} words, ` +
    `${cell.tasks} / ${taskTarget} tasks${cell.hit ? " (hit)" : ""}`;

  // Color rules:
  //   - hit: green
  //   - any words OR tasks: dim indigo (effort recorded, goal not met)
  //   - empty: faint border, no fill
  const isPartial = !cell.hit && (cell.words > 0 || cell.tasks > 0);

  return (
    <div
      title={tooltip}
      className={`h-6 flex-1 rounded border ${
        isToday ? "border-indigo-400" : "border-border"
      } ${
        cell.hit
          ? "bg-emerald-500/70"
          : isPartial
          ? "bg-indigo-500/40"
          : "bg-bg-surface"
      }`}
    />
  );
}


// ── Helpers ─────────────────────────────────────────────────────────────────

function shortRelpath(relpath: string): string {
  // Keep the last two path segments for readability:
  // "profiles/characters/kael-abc.md" -> "characters/kael-abc.md"
  const parts = relpath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return relpath;
  return parts.slice(-2).join("/");
}


function reasonLabel(reason: TaskCreditEntry["reason"]): string {
  switch (reason) {
    case "save":               return "save";
    case "advisor_default":    return "advisor (default)";
    case "advisor_full_set":   return "advisor (full sweep)";
    default:                   return reason;
  }
}
