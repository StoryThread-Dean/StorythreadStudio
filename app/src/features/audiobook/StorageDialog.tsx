// features/audiobook/StorageDialog.tsx
// ====================================
// What this audiobook is using on disk, and what the writer may delete
// (spec 25). A novel's worth of narration runs to gigabytes, and most of
// it is intermediate -- but "intermediate" is not the same as
// "worthless", so this screen is built to make the cost of each delete
// legible BEFORE the click, not after.
//
// Three rules the layout enforces:
//   - Nothing irreversible is ever pre-checked. Previews and failed takes
//     start ticked; anything that would cost a re-render (or the finished
//     audiobook itself) starts clear.
//   - Every row that loses something says what, in amber, on the row.
//     A consequence discovered afterwards is not a consequence, it is a
//     surprise.
//   - The confirm repeats the categories by name and the space freed.
//     Same doctrine as the print pass: the irreversible step always
//     restates what is about to happen.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, HardDrive, Loader2, Trash2, X } from "lucide-react";

import { fetchStorage, formatBytes, runCleanup, saveRetention } from "./api";
import type { RetentionMode, StorageReport } from "./api";
import { WhatsThis } from "./WhatsThis";

interface StorageDialogProps {
  workspacePath: string;
  /** The book's name, for the confirm text -- deleting the wrong book's
   * audio is exactly the mistake worth one extra word to prevent. */
  title?: string;
  onClose: () => void;
  /** Something was deleted: whatever is on screen behind this needs a
   * refresh (chapter statuses, the export panel). */
  onChanged?: () => void;
}

const RETENTION_LABELS: { value: RetentionMode; label: string; hint: string }[] = [
  { value: "keep", label: "Keep until I delete it",
    hint: "Fast repairs and re-exports stay possible. Uses the most space." },
  { value: "delete_after_export", label: "Delete after a successful export",
    hint: "Reclaims the space automatically. Fixing one paragraph later "
        + "means narrating the book again." },
  { value: "ask_after_export", label: "Ask me after each export",
    hint: "Decide per export, with the size in front of you." },
];

export function StorageDialog({
  workspacePath, title, onClose, onChanged,
}: StorageDialogProps) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchStorage(workspacePath);
      setReport(fresh);
      // Defaults come from the BACKEND, which is where the "never
      // pre-check anything irreversible" rule is enforced and tested.
      setSelected(new Set(
        fresh.categories.filter(c => c.default_selected && c.files > 0)
          .map(c => c.key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the workspace size.");
    }
  }, [workspacePath]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setNote(null);
  };

  const chosen = (report?.categories ?? []).filter(c => selected.has(c.key) && c.files > 0);
  const freeing = chosen.reduce((sum, c) => sum + c.bytes, 0);

  async function handleDelete() {
    if (chosen.length === 0) return;
    const names = chosen.map(c => c.label.toLowerCase()).join(", ");
    const losses = chosen.filter(c => c.consequence).map(c => `- ${c.consequence}`);
    const book = title ? ` from "${title}"` : "";
    const message = [
      `Delete ${names}${book}?`,
      "",
      `This frees about ${formatBytes(freeing)} and cannot be undone.`,
      ...(losses.length ? ["", ...losses] : []),
    ].join("\n");
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      const result = await runCleanup(workspacePath, chosen.map(c => c.key));
      setReport(result.storage);
      setSelected(new Set());
      setNote(
        result.problems.length
          ? `Freed ${formatBytes(result.freed_bytes)}. `
            + `${result.problems.length} file(s) would not delete -- close any `
            + `player using them and try again.`
          : `Freed ${formatBytes(result.freed_bytes)}.`,
      );
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRetention(mode: RetentionMode) {
    if (!report || report.retention === mode) return;
    setReport({ ...report, retention: mode });    // optimistic: it is one radio
    try {
      setReport(await saveRetention(workspacePath, mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that choice.");
      void load();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Audiobook storage"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-5 py-3">
          <HardDrive size={15} className="text-sky-300" />
          <h2 className="flex-1 text-sm font-semibold text-zinc-100">
            Storage and Cleanup
          </h2>
          <button
            onClick={onClose}
            aria-label="Close storage"
            className="rounded p-1 text-zinc-500 hover:text-zinc-100"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!report ? (
            <p className="text-xs text-zinc-400">
              <Loader2 size={12} className="mr-1 inline animate-spin" />
              Measuring this audiobook...
            </p>
          ) : (
            <div className="space-y-5">
              <p className="text-mini leading-relaxed text-zinc-400">
                This audiobook is using{" "}
                <span className="font-semibold text-zinc-200">
                  {formatBytes(report.total_bytes)}
                </span>
                . Everything below can be deleted, but only some of it can be
                rebuilt for free -- each row says which.
              </p>

              {/* Spec 25.3: the state a workspace falls into when its
                  audio is gone but the finished book is not. */}
              {report.export_only && (
                <div className="rounded border border-amber-800 bg-amber-950/40 px-3 py-2">
                  <p className="flex items-start gap-1.5 text-mini font-medium text-amber-300">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    Export only
                  </p>
                  <p className="mt-1 text-micro leading-relaxed text-amber-200/90">
                    {report.export_only_note}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                {report.categories.map(category => {
                  const empty = category.files === 0;
                  return (
                    <label
                      key={category.key}
                      className={"flex items-start gap-2.5 rounded border px-2.5 py-2 "
                        + (empty
                          ? "border-zinc-800 opacity-50"
                          : selected.has(category.key)
                            ? "cursor-pointer border-sky-700 bg-sky-950/30"
                            : "cursor-pointer border-zinc-700 hover:border-zinc-600")}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-sky-500"
                        checked={selected.has(category.key)}
                        disabled={empty || busy}
                        onChange={() => toggle(category.key)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-mini font-medium text-zinc-100">
                            {category.label}
                          </span>
                          <span className="shrink-0 text-micro tabular-nums text-zinc-400">
                            {empty ? "nothing here" : formatBytes(category.bytes)}
                          </span>
                        </span>
                        <span className="block text-micro leading-relaxed text-zinc-400">
                          {category.description}
                        </span>
                        {category.consequence && (
                          <span className={"mt-0.5 block text-micro leading-relaxed "
                            + (category.protected ? "text-rose-300/90" : "text-amber-300/80")}>
                            {category.consequence}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>

              <section>
                <h3 className="mb-1 border-b border-zinc-800 pb-2 text-mini font-semibold uppercase tracking-wider text-zinc-500">
                  Intermediate Audio
                </h3>
                <p className="mb-2 mt-2 text-mini leading-relaxed text-zinc-400">
                  What should happen to the segment files once this book
                  exports successfully?
                </p>
                <div className="space-y-1">
                  {RETENTION_LABELS.map(option => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-zinc-800/50"
                    >
                      <input
                        type="radio"
                        name="retention"
                        className="mt-0.5 accent-sky-500"
                        checked={report.retention === option.value}
                        onChange={() => void changeRetention(option.value)}
                      />
                      <span>
                        <span className="block text-mini text-zinc-200">
                          {option.label}
                        </span>
                        <span className="block text-micro leading-relaxed text-zinc-500">
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-1.5">
                  <WhatsThis label="Why keep them at all?">
                    The segment files are the narrated audio your exports are
                    built from. Keeping them means a typo fixed on page 200
                    re-narrates one paragraph instead of the whole book, and
                    you can re-export in another format without generating
                    speech again -- which on a paid engine is the difference
                    between free and paying twice.
                  </WhatsThis>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-zinc-800 px-5 py-3">
          {error && (
            <p className="min-w-0 flex-1 truncate text-mini text-rose-300" title={error}>
              {error}
            </p>
          )}
          {!error && note && (
            <p className="min-w-0 flex-1 text-mini text-emerald-300">{note}</p>
          )}
          {!error && !note && (
            <p className="min-w-0 flex-1 text-mini text-zinc-500">
              {chosen.length === 0
                ? "Nothing selected."
                : `Frees about ${formatBytes(freeing)}.`}
            </p>
          )}
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Close
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={chosen.length === 0 || busy}
            className="inline-flex items-center gap-2 rounded bg-rose-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Delete selected
          </button>
        </div>
      </div>
    </div>
  );
}
