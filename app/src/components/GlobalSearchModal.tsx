// GlobalSearchModal.tsx -- Global Search + Replace modal (Ctrl+Shift+F)
// ======================================================================
// Triggered by Ctrl+Shift+F when a project is open. Covers the full window
// with a centered modal overlay. Dismissible via Esc or the × button.
//
// UX flow:
//   1. Type in Find (min 2 chars) → debounced search fires after 300ms
//   2. Results appear grouped by file, all expanded, all hits checked
//   3. Uncheck individual hits or whole files to exclude them from replace
//   4. Click Replace, Replace all in file, or Replace All
//   5. If open chapter has unsaved edits and is in the replace set → warning
//   6. After replace → Undo button appears (restores from auto-snapshot)
//   7. If open file was modified → parent calls onFileModifiedByReplace

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Search, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type {
  FindResponse,
  FileMatches,
  MatchHit,
  ReplaceSelection,
  ReplaceResponse,
} from "../types/search";


const API_BASE = "http://localhost:8000";
const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;


// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectPath:    string;
  // The relative path of the file currently open in the editor, e.g.
  // "manuscript/01-chapter.md". Used for the unsaved-changes warning.
  openFileRelpath: string | null;
  // True if the editor has unsaved changes.
  isDirty: boolean;
  // Called when we need the parent to save before we can replace.
  onSaveRequest: () => Promise<void>;
  // Called after a successful replace with the list of file relpaths that
  // were modified, so the parent can reload the editor if needed.
  onFileModifiedByReplace: (relpaths: string[]) => void;
  onClose: () => void;
}


// ── Snapshot record (stored after a replace for the Undo button) ─────────────

interface SnapshotRecord {
  snapshot_dir:      string;
  files_modified:    number;
  replacements_made: number;
}


// ── Main component ───────────────────────────────────────────────────────────

export function GlobalSearchModal({
  projectPath,
  openFileRelpath,
  isDirty,
  onSaveRequest,
  onFileModifiedByReplace,
  onClose,
}: Props) {

  // ── Search inputs ─────────────────────────────────────────────────────────
  const [query,         setQuery]         = useState("");
  const [replacement,   setReplacement]   = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord,     setWholeWord]     = useState(false);

  // ── Search results + loading ──────────────────────────────────────────────
  const [results,     setResults]     = useState<FindResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Results tree UI state ─────────────────────────────────────────────────
  // expandedFiles: which file groups are collapsed (all expanded by default)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  // checkedHits: per-file set of checked hit indices (all checked by default)
  const [checkedHits, setCheckedHits] = useState<Map<string, Set<number>>>(new Map());

  // ── Replace state ─────────────────────────────────────────────────────────
  const [isReplacing,  setIsReplacing]  = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<SnapshotRecord | null>(null);

  // ── Unsaved-changes warning ───────────────────────────────────────────────
  // When the open file is in the replace set and has unsaved changes, we pause
  // and ask the user to save first. pendingAction stores what to run after save.
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const pendingActionRef = useRef<(() => Promise<void>) | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const findInputRef   = useRef<HTMLInputElement>(null);
  const debounceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);


  // ── Focus find input on mount ─────────────────────────────────────────────
  useEffect(() => {
    findInputRef.current?.focus();
  }, []);


  // ── Esc to close ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  // ── Search ────────────────────────────────────────────────────────────────

  const doSearch = useCallback(async (q: string, cs: boolean, ww: boolean) => {
    setIsSearching(true);
    setSearchError(null);
    setLastSnapshot(null);   // a new search invalidates the previous undo
    try {
      const res = await fetch(`${API_BASE}/api/search/find`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          project_path:   projectPath,
          query:          q,
          case_sensitive: cs,
          whole_word:     ww,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Search failed.");
      }
      const data: FindResponse = await res.json();
      setResults(data);
      // Default: all files expanded, all hits checked.
      setExpandedFiles(new Set());
      const checked = new Map<string, Set<number>>();
      for (const fm of data.matches) {
        checked.set(fm.file_relpath, new Set(fm.hits.map((_, i) => i)));
      }
      setCheckedHits(checked);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed.");
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  }, [projectPath]);


  // Debounce search on query / toggle changes.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (query.length < MIN_QUERY_LEN) {
      setResults(null);
      setSearchError(null);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      void doSearch(query, caseSensitive, wholeWord);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, caseSensitive, wholeWord, doSearch]);


  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleHit(fileRelpath: string, hitIdx: number) {
    setCheckedHits(prev => {
      const next = new Map(prev);
      const fileSet = new Set(next.get(fileRelpath) ?? []);
      if (fileSet.has(hitIdx)) fileSet.delete(hitIdx);
      else fileSet.add(hitIdx);
      next.set(fileRelpath, fileSet);
      return next;
    });
  }

  function toggleAllHitsInFile(fm: FileMatches) {
    setCheckedHits(prev => {
      const next = new Map(prev);
      const current = next.get(fm.file_relpath) ?? new Set<number>();
      // If all checked → uncheck all. Otherwise → check all.
      const allChecked = current.size === fm.hits.length;
      next.set(
        fm.file_relpath,
        allChecked ? new Set() : new Set(fm.hits.map((_, i) => i)),
      );
      return next;
    });
  }

  function toggleExpanded(fileRelpath: string) {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileRelpath)) next.delete(fileRelpath);
      else next.add(fileRelpath);
      return next;
    });
  }

  // Build the selections array for a replace call.
  function buildSelections(only?: { file_relpath: string; hit_indices: number[] }): ReplaceSelection[] {
    if (only) return [only];
    if (!results) return [];
    return results.matches
      .map(fm => ({
        file_relpath: fm.file_relpath,
        hit_indices:  [...(checkedHits.get(fm.file_relpath) ?? new Set())].sort((a, b) => a - b),
      }))
      .filter(s => s.hit_indices.length > 0);
  }


  // ── Replace ───────────────────────────────────────────────────────────────

  const executeReplace = useCallback(async (selections: ReplaceSelection[]) => {
    setIsReplacing(true);
    setReplaceError(null);
    try {
      const res = await fetch(`${API_BASE}/api/search/replace`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          project_path:   projectPath,
          query,
          replacement,
          case_sensitive: caseSensitive,
          whole_word:     wholeWord,
          selections,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Replace failed.");
      }
      const data: ReplaceResponse = await res.json();
      setLastSnapshot({
        snapshot_dir:      data.snapshot_dir,
        files_modified:    data.files_modified,
        replacements_made: data.replacements_made,
      });

      // Notify parent so it can reload the editor if the open file was touched.
      const modifiedRelpaths = selections.map(s => s.file_relpath);
      onFileModifiedByReplace(modifiedRelpaths);

      // Refresh the search results so the modal shows the post-replace state.
      await doSearch(query, caseSensitive, wholeWord);
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : "Replace failed.");
    } finally {
      setIsReplacing(false);
    }
  }, [projectPath, query, replacement, caseSensitive, wholeWord, doSearch, onFileModifiedByReplace]);


  // Guard: if open file has unsaved changes and is in the selection, warn first.
  function guardReplace(selections: ReplaceSelection[]) {
    const openIsAffected =
      isDirty &&
      openFileRelpath !== null &&
      selections.some(s => s.file_relpath === openFileRelpath);

    if (openIsAffected) {
      pendingActionRef.current = () => executeReplace(selections);
      setShowUnsavedWarning(true);
    } else {
      void executeReplace(selections);
    }
  }

  async function handleSaveAndContinue() {
    setShowUnsavedWarning(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (!action) return;
    try {
      await onSaveRequest();
      await action();
    } catch {
      setReplaceError("Save failed. Replace aborted.");
    }
  }

  function handleCancelReplace() {
    setShowUnsavedWarning(false);
    pendingActionRef.current = null;
  }


  // ── Undo ──────────────────────────────────────────────────────────────────

  async function handleUndo() {
    if (!lastSnapshot) return;
    setIsReplacing(true);
    setReplaceError(null);
    try {
      const res = await fetch(`${API_BASE}/api/search/restore`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          project_path: projectPath,
          snapshot_dir: lastSnapshot.snapshot_dir,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Restore failed.");
      }
      setLastSnapshot(null);
      // Notify parent to reload the editor if it was affected.
      if (results) {
        onFileModifiedByReplace(results.matches.map(m => m.file_relpath));
      }
      // Refresh results to show the restored state.
      await doSearch(query, caseSensitive, wholeWord);
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : "Undo failed.");
    } finally {
      setIsReplacing(false);
    }
  }


  // ── Derived UI values ─────────────────────────────────────────────────────

  const totalChecked = results
    ? results.matches.reduce((acc, fm) => acc + (checkedHits.get(fm.file_relpath)?.size ?? 0), 0)
    : 0;


  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal panel */}
      <div className="flex w-full max-w-3xl flex-col rounded border border-border bg-bg-panel shadow-2xl"
           style={{ maxHeight: "85vh" }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-text-muted" />
            <h2 className="text-sm font-semibold text-text-primary">Global Search + Replace</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-faint transition-colors hover:bg-bg-surface hover:text-text-primary"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Search controls ── */}
        <div className="border-b border-border px-4 py-3 space-y-2">
          {/* Find row */}
          <div className="flex items-center gap-2">
            <input
              ref={findInputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find (min 2 characters)…"
              className="flex-1 rounded border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-faint focus:border-indigo-500 focus:outline-none"
            />
            {/* Case-sensitive toggle */}
            <TogglePill
              active={caseSensitive}
              onClick={() => setCaseSensitive(v => !v)}
              title="Case-sensitive"
              label="Aa"
            />
            {/* Whole-word toggle */}
            <TogglePill
              active={wholeWord}
              onClick={() => setWholeWord(v => !v)}
              title="Whole word"
              label="W"
            />
          </div>

          {/* Replace row */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={replacement}
              onChange={e => setReplacement(e.target.value)}
              placeholder="Replace with…"
              className="flex-1 rounded border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-faint focus:border-indigo-500 focus:outline-none"
            />
            {/* Spacer to align with the two pills above */}
            <div className="w-[4.5rem]" />
          </div>
        </div>

        {/* ── Status bar ── */}
        <div className="border-b border-border px-4 py-1.5">
          {isSearching && (
            <p className="text-xs text-text-muted">Searching…</p>
          )}
          {!isSearching && searchError && (
            <p className="text-xs text-rose-400">{searchError}</p>
          )}
          {!isSearching && !searchError && results && (
            <p className="text-xs text-text-muted">
              {results.total_hits === 0
                ? "No matches found."
                : `${results.total_hits} match${results.total_hits === 1 ? "" : "es"} in ${results.matches.length} file${results.matches.length === 1 ? "" : "s"}`}
              {totalChecked > 0 && ` · ${totalChecked} selected`}
            </p>
          )}
          {!isSearching && !searchError && !results && query.length >= MIN_QUERY_LEN && (
            <p className="text-xs text-faint">Ready to search…</p>
          )}
          {!isSearching && query.length < MIN_QUERY_LEN && query.length > 0 && (
            <p className="text-xs text-faint">Type at least 2 characters to search.</p>
          )}
          {!isSearching && query.length === 0 && (
            <p className="text-xs text-faint">Enter a search term above.</p>
          )}
        </div>

        {/* ── Results tree (scrollable) ── */}
        <div className="flex-1 overflow-y-auto">
          {results && results.matches.length > 0 && results.matches.map(fm => (
            <FileGroup
              key={fm.file_relpath}
              fm={fm}
              expanded={!expandedFiles.has(fm.file_relpath)}
              checkedSet={checkedHits.get(fm.file_relpath) ?? new Set()}
              onToggleExpand={() => toggleExpanded(fm.file_relpath)}
              onToggleAll={() => toggleAllHitsInFile(fm)}
              onToggleHit={(idx) => toggleHit(fm.file_relpath, idx)}
              onReplaceFile={() => {
                const indices = [...(checkedHits.get(fm.file_relpath) ?? new Set())].sort((a, b) => a - b);
                if (indices.length === 0) return;
                guardReplace([{ file_relpath: fm.file_relpath, hit_indices: indices }]);
              }}
              onReplaceHit={(idx) => {
                guardReplace([{ file_relpath: fm.file_relpath, hit_indices: [idx] }]);
              }}
              disabled={isReplacing}
            />
          ))}
        </div>

        {/* ── Footer ── */}
        <div className="border-t border-border px-4 py-3 space-y-2">
          {/* Unsaved-changes warning */}
          {showUnsavedWarning && (
            <div className="rounded border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs">
              <p className="font-medium text-amber-300">Unsaved changes in open chapter</p>
              <p className="mt-0.5 text-amber-400/80">
                The currently open file is in the replace set and has unsaved edits.
                Save first to avoid overwriting in-memory changes.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveAndContinue()}
                  className="rounded border border-amber-600 bg-amber-700/30 px-3 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-700/50"
                >
                  Save &amp; Continue
                </button>
                <button
                  type="button"
                  onClick={handleCancelReplace}
                  className="rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-border hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Replace error */}
          {replaceError && (
            <p className="text-xs text-rose-400">{replaceError}</p>
          )}

          {/* Last replace summary + undo */}
          {lastSnapshot && (
            <div className="flex items-center gap-3 rounded border border-emerald-800/40 bg-emerald-950/30 px-3 py-2">
              <p className="flex-1 text-xs text-emerald-300">
                Replaced {lastSnapshot.replacements_made} occurrence{lastSnapshot.replacements_made === 1 ? "" : "s"} in {lastSnapshot.files_modified} file{lastSnapshot.files_modified === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={isReplacing}
                className="flex items-center gap-1.5 rounded border border-emerald-700/50 px-2 py-1 text-xs text-emerald-300 transition-colors hover:border-emerald-500 hover:text-emerald-200 disabled:opacity-40"
                title="Restore all touched files from the pre-replace snapshot"
              >
                <RotateCcw size={11} />
                Undo
              </button>
            </div>
          )}

          {/* Replace All button row */}
          {!showUnsavedWarning && (
            <div className="flex items-center justify-end gap-2">
              {isReplacing && (
                <span className="text-xs text-text-muted">Working…</span>
              )}
              <button
                type="button"
                disabled={isReplacing || totalChecked === 0}
                onClick={() => guardReplace(buildSelections())}
                className="rounded border border-indigo-700 bg-indigo-900/40 px-4 py-1.5 text-xs font-medium text-indigo-200 transition-colors hover:border-indigo-500 hover:bg-indigo-800/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Replace All ({totalChecked})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Toggle pill ──────────────────────────────────────────────────────────────

function TogglePill({
  active, onClick, title, label,
}: {
  active: boolean; onClick: () => void; title: string; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded border px-2 py-1.5 text-xs font-mono transition-colors ${
        active
          ? "border-indigo-500 bg-indigo-700/40 text-indigo-200"
          : "border-border bg-bg-surface text-faint hover:border-indigo-600 hover:text-text-muted"
      }`}
    >
      {label}
    </button>
  );
}


// ── FileGroup ────────────────────────────────────────────────────────────────

function FileGroup({
  fm, expanded, checkedSet, onToggleExpand, onToggleAll,
  onReplaceFile, onReplaceHit, onToggleHit, disabled,
}: {
  fm:             FileMatches;
  expanded:       boolean;
  checkedSet:     Set<number>;
  onToggleExpand: () => void;
  onToggleAll:    () => void;
  onReplaceFile:  () => void;
  onReplaceHit:   (idx: number) => void;
  onToggleHit:    (idx: number) => void;
  disabled:       boolean;
}) {
  const allChecked = checkedSet.size === fm.hits.length;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* File header row */}
      <div className="flex items-center gap-2 bg-bg-surface/50 px-3 py-1.5">
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 text-faint hover:text-text-muted"
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Select-all checkbox for this file */}
        <input
          type="checkbox"
          checked={allChecked}
          onChange={onToggleAll}
          className="shrink-0 accent-indigo-500"
          title="Select / deselect all matches in this file"
        />

        {/* Relative path */}
        <span className="flex-1 truncate font-mono text-xs text-indigo-300" title={fm.file_relpath}>
          {fm.file_relpath}
        </span>

        {/* Match count badge */}
        <span className="shrink-0 rounded bg-bg-panel px-1.5 py-0.5 text-xs text-faint">
          {fm.count}
        </span>

        {/* Replace all checked in this file */}
        <button
          type="button"
          onClick={onReplaceFile}
          disabled={disabled || checkedSet.size === 0}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Replace in file
        </button>
      </div>

      {/* Hit rows (only shown when expanded) */}
      {expanded && (
        <div>
          {fm.hits.map((hit, idx) => (
            <HitRow
              key={idx}
              hit={hit}
              checked={checkedSet.has(idx)}
              onToggle={() => onToggleHit(idx)}
              onReplace={() => onReplaceHit(idx)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ── HitRow ───────────────────────────────────────────────────────────────────

function HitRow({
  hit, checked, onToggle, onReplace, disabled,
}: {
  hit:      MatchHit;
  checked:  boolean;
  onToggle: () => void;
  onReplace: () => void;
  disabled: boolean;
}) {
  return (
    <div className={`flex gap-2 border-t border-border/50 px-3 py-2 ${checked ? "" : "opacity-50"}`}>
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 shrink-0 accent-indigo-500"
      />

      {/* Context block */}
      <div className="min-w-0 flex-1 font-mono text-xs">
        {hit.context_before && (
          <p className="truncate text-faint">{hit.context_before}</p>
        )}
        <HighlightedLine line={hit.context_match} col={hit.col} len={hit.match_length} />
        {hit.context_after && (
          <p className="truncate text-faint">{hit.context_after}</p>
        )}
        <p className="mt-0.5 text-faint">Line {hit.line}, col {hit.col}</p>
      </div>

      {/* Replace this hit only */}
      <button
        type="button"
        onClick={onReplace}
        disabled={disabled || !checked}
        className="shrink-0 self-start rounded border border-border px-2 py-0.5 text-xs text-faint transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
        title="Replace this match only"
      >
        Replace
      </button>
    </div>
  );
}


// ── HighlightedLine ──────────────────────────────────────────────────────────
// Renders a line with the matched substring highlighted, using col + len
// from the backend to locate the match precisely.

function HighlightedLine({ line, col, len }: { line: string; col: number; len: number }) {
  const before = line.slice(0, col);
  const match  = line.slice(col, col + len);
  const after  = line.slice(col + len);

  return (
    <p className="truncate text-text-primary">
      {before}
      <mark className="rounded-sm bg-amber-500/30 px-0.5 text-amber-200 not-italic">
        {match}
      </mark>
      {after}
    </p>
  );
}
