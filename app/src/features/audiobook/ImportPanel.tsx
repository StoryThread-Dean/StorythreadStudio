// features/audiobook/ImportPanel.tsx
// ===================================
// The Get Started flow (spec 5.1.2): pick the book, and the workspace
// location is CHOSEN FOR YOU -- beside a Storythread book, or under
// Documents/Storythread Audiobooks for a manuscript from anywhere else.
// The writer can always change it, but never has to invent a folder.
// The backend copies the original in, extracts chapters, and builds the
// whole workspace; this panel gathers the inputs and shows honest errors
// (ruby) when something is off (unsupported format, taken folder, PDF).

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft, BookOpen, Check, FileText, FolderOpen, Loader2, Sparkles,
} from "lucide-react";

import { importSource, suggestWorkspace } from "./api";
import type { WorkspaceSuggestion } from "./api";
import type { AudiobookProjectPayload } from "./types";

interface ImportPanelProps {
  onBack: () => void;
  /** Import finished -- hand the fresh workspace payload up. */
  onImported: (payload: AudiobookProjectPayload) => void;
}

export function ImportPanel({ onBack, onImported }: ImportPanelProps) {
  const [sourcePath, setSourcePath] = useState("");
  const [sourceKind, setSourceKind] = useState<"file" | "project" | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [title, setTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The suggested location, and whether the writer took it over. Once
  // they pick their own folder we stop moving it under them.
  const [suggestion, setSuggestion] = useState<WorkspaceSuggestion | null>(null);
  const [chosenByWriter, setChosenByWriter] = useState(false);

  // Suggest a home as soon as there is a source (and re-suggest when the
  // title changes, since an outside manuscript's folder is named after
  // the book). Debounced so typing a title is not a request per keystroke.
  useEffect(() => {
    if (!sourcePath || chosenByWriter) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const fresh = await suggestWorkspace(sourcePath, title);
          setSuggestion(fresh);
          setWorkspacePath(fresh.workspace_path);
        } catch { /* the writer can still choose a folder by hand */ }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [sourcePath, title, chosenByWriter]);

  const pickManuscriptFile = useCallback(async () => {
    const selected = await openDialog({
      title: "Choose a manuscript",
      filters: [
        // PDF joined the list in Stage F -- text-based PDFs only. A
        // scanned one is refused with the reason and the workaround, so
        // offering it here costs nothing and hiding it would send
        // writers hunting for a converter they may not need.
        { name: "Manuscripts", extensions: ["docx", "epub", "md", "markdown", "pdf", "txt"] },
      ],
    });
    if (typeof selected === "string" && selected) {
      setSourcePath(selected);
      setSourceKind("file");
      setError(null);
    }
  }, []);

  const pickStorythreadProject = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Choose a Storythread project folder",
    });
    if (typeof selected === "string" && selected) {
      setSourcePath(selected);
      setSourceKind("project");
      setError(null);
    }
  }, []);

  const pickWorkspaceFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Choose a new or empty folder for the audiobook workspace",
    });
    if (typeof selected === "string" && selected) {
      setWorkspacePath(selected);
      setChosenByWriter(true);         // stop re-suggesting under them
      setError(null);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!sourcePath || !workspacePath || importing) return;
    setImporting(true);
    setError(null);
    try {
      onImported(await importSource(sourcePath, workspacePath, title));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }, [sourcePath, workspacePath, title, importing, onImported]);

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-10">
      <button
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-300"
      >
        <ArrowLeft size={12} /> Back to dashboard
      </button>

      <h1 className="mb-1 flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <Sparkles size={17} className="text-emerald-400" /> Let's Get Started
      </h1>
      <p className="mb-6 text-xs leading-relaxed text-zinc-500">
        Point at the book you want narrated. Storythread copies it into a
        workspace of its own, so your original file is never modified and
        later edits to it will not disturb this audiobook.
      </p>

      {/* Step 1: the source */}
      <h2 className="mb-2 text-sm font-semibold text-blue-300">1. Your book</h2>
      <div className="mb-2 flex flex-wrap gap-3">
        <button
          onClick={() => void pickManuscriptFile()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-300"
        >
          <FileText size={15} /> Choose Manuscript File
        </button>
        <button
          onClick={() => void pickStorythreadProject()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-300"
        >
          <BookOpen size={15} /> Import from a Storythread Project
        </button>
      </div>
      <p className="mb-1 text-mini text-zinc-600">
        DOCX, EPUB, Markdown, TXT, or PDF. A PDF has to contain real text
        rather than page images -- a scanned book will say so and stop.
      </p>
      {sourcePath && (
        <p className="mb-4 truncate rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-emerald-300" title={sourcePath}>
          {sourceKind === "project" ? "Project: " : "File: "}{sourcePath}
        </p>
      )}

      {/* Step 2: the workspace -- chosen FOR the writer (spec 5.1.2). */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-blue-300">
        2. Where it will live
      </h2>
      {!sourcePath ? (
        <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-3 text-xs text-zinc-600">
          Choose your book above and a home is picked automatically.
        </p>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3">
          <p className="mb-1 flex items-start gap-2 text-xs text-emerald-300">
            <Check size={13} className="mt-0.5 shrink-0" />
            <span className="break-all" title={workspacePath}>{workspacePath}</span>
          </p>
          {suggestion && !chosenByWriter && (
            <p className="pl-5 text-mini leading-relaxed text-zinc-500">
              {suggestion.reason}
              {suggestion.collision
                && " That name was taken, so the next free folder is suggested."}
            </p>
          )}
          {chosenByWriter && (
            <p className="pl-5 text-mini text-zinc-500">Your chosen folder.</p>
          )}
          <button
            onClick={() => void pickWorkspaceFolder()}
            className="mt-2 inline-flex items-center gap-1.5 pl-5 text-mini text-blue-400 hover:text-blue-300 hover:underline"
          >
            <FolderOpen size={11} /> Choose a different folder
          </button>
        </div>
      )}
      <p className="mt-1 text-mini text-zinc-600">
        Everything for this audiobook lives here: the copied source, the
        narration text, generated audio, and final exports.
      </p>

      {/* Step 3: optional title */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-blue-300">
        3. Title <span className="font-normal text-zinc-600">(optional -- detected from the manuscript when blank)</span>
      </h2>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="e.g. The Hollow Road"
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500"
      />

      {error && (
        <p className="mt-4 rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <button
        onClick={() => void handleImport()}
        disabled={!sourcePath || !workspacePath || importing}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {importing && <Loader2 size={15} className="animate-spin" />}
        {importing ? "Setting up your workspace..." : "Create My Audiobook Workspace"}
      </button>
    </div>
  );
}
