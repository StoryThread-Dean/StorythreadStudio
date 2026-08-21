// ExportModal.tsx -- Manuscript Export Dialog
// ==============================================
// A modal that lets the writer export their manuscript in two ways:
//
//   1. Full Manuscript -- combines all chapters into a single .md file
//   2. Snapshot -- saves a dated copy of all chapters + project.json
//
// The modal shows success/error feedback inline so the writer can see
// exactly where their export was saved without leaving the editor.
//
// Phase 6 polish: writers can pick which chapters to export instead of always
// shipping every file. The Chapters section is expandable so the default
// surface stays compact -- the common case (export everything) is still one
// click. When the writer expands it, they get checkboxes plus select-all /
// none controls. The backend treats "no filenames" as "all chapters" so
// older callers and the collapsed-default flow keep working unchanged.

import { useEffect, useMemo, useState } from "react";
import {
  X, FileText, Camera, CheckCircle, AlertCircle, Loader,
  ChevronDown, ChevronRight, Network,
} from "lucide-react";
import { Explain } from "./learn/Explain";
import type { ProjectInfo, ChapterInfo } from "../types/project";

const API_BASE = "http://localhost:8000";

interface ExportModalProps {
  project: ProjectInfo;
  onClose: () => void;
}

export function ExportModal({ project, onClose }: ExportModalProps) {

  // --- State ---
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<{ type: string; path: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Output format for the Full Manuscript export.
  // Snapshot is always a folder of .md files regardless of this setting.
  type ExportFormat = "markdown" | "txt" | "docx" | "epub";
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");

  // Opt-in extras. Only available for markdown/txt exports; DOCX and EPUB
  // are prose-only clean publish formats where notes/profiles don't belong.
  const [includeChapterSummaries, setIncludeChapterSummaries] = useState(false);
  const [includeSceneSummaries,   setIncludeSceneSummaries]   = useState(false);
  const [includeNotes,            setIncludeNotes]            = useState(false);
  const [includeProfiles,         setIncludeProfiles]         = useState(false);
  // THE WEAVE ITSELF, which is a different thing from the entries. Profiles
  // exports what the writer WROTE; this exports what the Weave ADDS -- who is
  // connected to whom and why, and what is true at which point in the book.
  const [includeWeave,            setIncludeWeave]            = useState(false);

  const extrasAvailable = exportFormat === "markdown" || exportFormat === "txt";

  // --- Chapter selection state ---
  // chapters: list of every chapter file in manuscript/ (fetched on mount).
  // selectedFilenames: which ones the writer has checked. Starts as the full
  // set so the default behavior matches the old "export everything" flow.
  // chaptersExpanded: whether the picker is open. Collapsed by default to
  // keep the modal compact; the writer can open it to narrow the export.
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [chaptersExpanded, setChaptersExpanded] = useState(false);
  const [chaptersLoadError, setChaptersLoadError] = useState<string | null>(null);

  // Fetch the chapter list once when the modal opens. We need this to render
  // the per-chapter checkboxes; without it the writer has nothing to pick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ folder_path: project.root_path });
        const res = await fetch(`${API_BASE}/api/documents/chapters?${params}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Failed to load chapter list.");
        }
        const list = (await res.json()) as ChapterInfo[];
        if (cancelled) return;
        setChapters(list);
        // Default selection = all chapters. Writer can uncheck to narrow it.
        setSelectedFilenames(new Set(list.map((c) => c.filename)));
      } catch (err) {
        if (!cancelled) {
          setChaptersLoadError(err instanceof Error ? err.message : "Could not load chapter list.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [project.root_path]);

  // Derived: are all / none selected? Drives the "Select all" / "Clear"
  // shortcut buttons and lets us render an indeterminate-looking summary.
  const allSelected = useMemo(
    () => chapters.length > 0 && selectedFilenames.size === chapters.length,
    [chapters.length, selectedFilenames.size],
  );
  const noneSelected = selectedFilenames.size === 0;

  function toggleChapter(filename: string) {
    setSelectedFilenames((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  function selectAll()  { setSelectedFilenames(new Set(chapters.map((c) => c.filename))); }
  function selectNone() { setSelectedFilenames(new Set()); }

  // --- Export Handlers ---

  const handleExport = async (exportType: "full-manuscript" | "snapshot") => {
    setIsExporting(true);
    setError(null);
    setResult(null);

    try {
      // If the writer left every box checked, send `null` for chapter_filenames
      // so the backend takes the all-chapters fast path. Sending the full list
      // would work too but the explicit "all" intent is clearer in logs.
      const sendAll = allSelected || chapters.length === 0;
      const chapterFilenames = sendAll ? null : Array.from(selectedFilenames);

      const res = await fetch(`${API_BASE}/api/export/${exportType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path:               project.root_path,
          format:                    exportType === "full-manuscript" ? exportFormat : "markdown",
          include_chapter_summaries: includeChapterSummaries,
          include_scene_summaries:   includeSceneSummaries,
          include_notes:             includeNotes,
          include_profiles:          includeProfiles,
          include_weave:             includeWeave,
          chapter_filenames:         chapterFilenames,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Export failed.");
      }

      const data = await res.json();
      setResult({
        type: data.export_type,
        path: data.output_path,
        message: data.message,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * The bundle, which is its own endpoint rather than an export type.
   *
   * It writes a folder rather than a file, and it does not take a chapter
   * selection or a format -- a world is not a manuscript and pretending
   * otherwise would put four irrelevant controls in front of the writer.
   */
  const handleWeaveExport = async () => {
    setIsExporting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/export/weave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: project.root_path }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Export failed.");
      }
      const data = await res.json();
      setResult({ type: data.export_type, path: data.output_path,
                  message: data.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  // --- Render ---
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal card */}
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-border bg-bg-panel shadow-e4">

        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-border"
          style={{ padding: "1rem 1.5rem" }}
        >
          <h2 className="text-base font-semibold text-text-primary">Export Manuscript</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body -- scrollable when the chapter picker is expanded on long projects */}
        <div style={{ padding: "1.5rem" }} className="flex flex-col gap-4 overflow-y-auto">

          {/* ── Chapter picker ─────────────────────────────────────────────
              Expandable list of every chapter in manuscript/. Collapsed by
              default with a one-line summary so the modal stays small for
              the common "export everything" case. Expanding reveals
              checkboxes + Select all / Clear shortcuts. */}
          <div className="rounded-lg border border-border bg-bg-primary">
            <button
              type="button"
              onClick={() => setChaptersExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-2 p-3 text-left"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-accent">
                {chaptersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Chapters
              </span>
              <span className="text-mini text-text-muted">
                {chaptersLoadError
                  ? "load failed"
                  : chapters.length === 0
                  ? "loading..."
                  : allSelected
                  ? `All ${chapters.length} chapters`
                  : noneSelected
                  ? "None selected"
                  : `${selectedFilenames.size} of ${chapters.length}`}
              </span>
            </button>

            {chaptersExpanded && (
              <div className="border-t border-border p-3">
                {chaptersLoadError ? (
                  <p className="text-xs text-danger">{chaptersLoadError}</p>
                ) : chapters.length === 0 ? (
                  <p className="text-xs text-text-muted">No chapters found in manuscript/.</p>
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-2 text-mini">
                      <button
                        type="button"
                        onClick={selectAll}
                        disabled={allSelected || isExporting}
                        className="rounded border border-border px-2 py-0.5 text-accent transition-colors hover:border-accent-fill disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={selectNone}
                        disabled={noneSelected || isExporting}
                        className="rounded border border-border px-2 py-0.5 text-accent transition-colors hover:border-accent-fill disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Clear
                      </button>
                      <span className="ml-auto text-micro text-text-muted">
                        {selectedFilenames.size}/{chapters.length}
                      </span>
                    </div>

                    {/* Cap the visible list height so a 50-chapter project
                        doesn't make the modal taller than the window. */}
                    <div className="max-h-48 overflow-y-auto rounded border border-border bg-bg-panel p-2">
                      <div className="flex flex-col gap-1">
                        {chapters.map((c) => (
                          <label
                            key={c.filename}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-text-primary hover:bg-bg-raised"
                          >
                            <input
                              type="checkbox"
                              checked={selectedFilenames.has(c.filename)}
                              onChange={() => toggleChapter(c.filename)}
                              disabled={isExporting}
                              className="accent-accent-fill"
                            />
                            <span className="flex-1 truncate" title={c.title}>{c.title}</span>
                            <span className="shrink-0 font-mono text-micro text-text-muted">
                              {c.filename}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Format picker ─────────────────────────────────────────────
              Applies to Full Manuscript only. Snapshot is always a folder
              of .md files regardless of this setting. */}
          <div className="rounded-lg border border-border bg-bg-primary p-3">
            <p className="mb-2 text-xs font-medium text-accent">Export format</p>
            <div className="flex gap-2">
              {(["markdown", "txt", "docx", "epub"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setExportFormat(fmt)}
                  disabled={isExporting}
                  className={`rounded border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    exportFormat === fmt
                      ? "border-accent-fill bg-accent-soft text-accent"
                      : "border-border text-text-muted hover:border-accent-muted hover:text-text-primary"
                  }`}
                >
                  {fmt === "markdown" ? ".MD" : fmt === "txt" ? ".TXT" : fmt.toUpperCase()}
                </button>
              ))}
            </div>
            {!extrasAvailable && (
              <p className="mt-2 text-micro text-text-muted">
                {exportFormat.toUpperCase()} export is prose-only -- extras are not included.
              </p>
            )}
          </div>

          {/* Optional extras -- only shown for Markdown / TXT formats.
              DOCX and EPUB are clean publish files; notes/profiles don't belong. */}
          <div className={`rounded-lg border border-border bg-bg-primary p-3 transition-opacity ${
            extrasAvailable ? "opacity-100" : "opacity-30 pointer-events-none"
          }`}>
            <p className="mb-2 text-xs font-medium text-accent">
              Include {!extrasAvailable && <span className="text-text-muted">(Markdown / TXT only)</span>}
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={includeChapterSummaries}
                  onChange={(e) => setIncludeChapterSummaries(e.target.checked)}
                  disabled={isExporting || !extrasAvailable}
                  className="accent-accent-fill"
                />
                <span>Chapter summaries</span>
                <span className="text-micro text-text-muted">summaries/chapters/</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={includeSceneSummaries}
                  onChange={(e) => setIncludeSceneSummaries(e.target.checked)}
                  disabled={isExporting || !extrasAvailable}
                  className="accent-accent-fill"
                />
                <span>Scene summaries</span>
                <span className="text-micro text-text-muted">summaries/scenes/</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(e) => setIncludeNotes(e.target.checked)}
                  disabled={isExporting || !extrasAvailable}
                  className="accent-accent-fill"
                />
                <span>Notes</span>
                <span className="text-micro text-text-muted">notes/ (outline, style guide)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={includeProfiles}
                  onChange={(e) => setIncludeProfiles(e.target.checked)}
                  disabled={isExporting || !extrasAvailable}
                  className="accent-accent-fill"
                />
                <span>Profiles</span>
                <span className="text-micro text-text-muted">every entry, as you wrote it</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={includeWeave}
                  onChange={(e) => setIncludeWeave(e.target.checked)}
                  disabled={isExporting || !extrasAvailable}
                  className="accent-weave-fill"
                />
                <span>The Weave</span>
                <span className="text-micro text-text-muted">
                  connections, and what changes through the story
                </span>
              </label>
            </div>
          </div>

          {/* THE WEAVE ON ITS OWN.
              Its own button rather than a third checkbox, because it answers a
              different question: not "what goes in my manuscript" but "how do I
              get my world OUT of this app". A writer reaching for that is
              usually leaving, backing up, or handing the world to somebody
              else, and none of those want a novel wrapped around it. */}
          <div className="rounded-lg border border-weave-soft/60 bg-weave-soft/10 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Network size={16} className="shrink-0 text-weave" />
              <p className="text-sm font-medium text-text-primary">
                Export the Weave on its own
              </p>
              <Explain of="export.weave" compact />
            </div>
            <p className="mb-3 text-xs text-text-muted">
              Your world model in three shapes at once: a Markdown document you
              can read, a JSON file a program can read, and CSV tables for a
              spreadsheet. Chapters appear by name as well as by id, so the
              files stay readable outside this app.
            </p>
            <button
              onClick={() => handleWeaveExport()}
              disabled={isExporting}
              className="inline-flex items-center gap-2 rounded border border-weave-fill px-3 py-1.5 text-xs font-medium text-weave-strong transition-colors hover:border-weave-fill hover:bg-weave-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Network size={13} />
              {isExporting ? "Exporting..." : "Export the Weave"}
            </button>
          </div>

          {/* Export option: Full Manuscript */}
          <button
            onClick={() => handleExport("full-manuscript")}
            disabled={isExporting || noneSelected}
            className="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-accent-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={20} className="mt-0.5 shrink-0 text-accent-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">Full Manuscript</p>
              <p className="mt-1 text-xs text-text-muted">
                Combine selected chapters into a single{" "}
                {exportFormat === "markdown" ? "Markdown (.md)" :
                 exportFormat === "txt"      ? "plain text (.txt)" :
                 exportFormat === "docx"     ? "Word document (.docx)" :
                                              "EPUB e-book (.epub)"}{" "}
                file. Overwrites the previous export so you always have one canonical copy.
              </p>
            </div>
          </button>

          {/* Export option: Snapshot */}
          <button
            onClick={() => handleExport("snapshot")}
            disabled={isExporting || noneSelected}
            className="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-accent-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera size={20} className="mt-0.5 shrink-0 text-accent-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">Snapshot</p>
              <p className="mt-1 text-xs text-text-muted">
                Save a dated copy of selected chapters and project settings.
                Each snapshot is a new folder so you can look back at earlier versions.
              </p>
            </div>
          </button>

          {noneSelected && chapters.length > 0 && (
            <p className="text-xs text-warn">
              Pick at least one chapter to export.
            </p>
          )}

          {/* Loading indicator */}
          {isExporting && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader size={14} className="animate-spin" />
              Exporting...
            </div>
          )}

          {/* Success message */}
          {result && (
            <div className="rounded-lg border border-success-fill bg-success-soft/40 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle size={16} className="mt-0.5 shrink-0 text-success-muted" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-success">{result.message}</p>
                  <p
                    className="mt-1 break-all font-mono text-xs text-success-muted/70"
                    title={result.path}
                  >
                    {result.path}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="rounded-lg border border-danger-fill bg-danger-soft/40 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger-muted" />
                <p className="text-xs text-danger">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
