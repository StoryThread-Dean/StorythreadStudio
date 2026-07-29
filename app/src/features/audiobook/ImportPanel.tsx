// features/audiobook/ImportPanel.tsx
// ===================================
// Wizard Step 1: Import. Pick a source (a manuscript file OR an existing
// Storythread project folder), pick an empty workspace folder, optionally
// override the title, and import. The backend copies the original in,
// extracts chapters, and builds the whole workspace -- this panel only
// gathers the three inputs and shows honest errors (ruby) when something
// is off (unsupported format, non-empty folder, PDF).

import { useCallback, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, BookOpen, FileText, FolderOpen, Loader2 } from "lucide-react";

import { importSource } from "./api";
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

  const pickManuscriptFile = useCallback(async () => {
    const selected = await openDialog({
      title: "Choose a manuscript",
      filters: [
        // PDF is deliberately absent -- deferred; the backend would reject
        // it with the honest message anyway, but not offering it is kinder.
        { name: "Manuscripts", extensions: ["docx", "epub", "md", "markdown", "txt"] },
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

      <h1 className="mb-1 text-lg font-semibold text-zinc-100">New Audiobook</h1>
      <p className="mb-6 text-xs text-zinc-500">
        The manuscript is copied into the audiobook workspace. Your original
        file is never modified, and later changes to it won't affect this
        audiobook.
      </p>

      {/* Step 1: the source */}
      <h2 className="mb-2 text-sm font-semibold text-blue-300">1. Manuscript</h2>
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
      <p className="mb-1 text-[11px] text-zinc-600">
        DOCX, EPUB, Markdown, or TXT. PDF isn't supported yet.
      </p>
      {sourcePath && (
        <p className="mb-4 truncate rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-emerald-300" title={sourcePath}>
          {sourceKind === "project" ? "Project: " : "File: "}{sourcePath}
        </p>
      )}

      {/* Step 2: the workspace */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-blue-300">2. Workspace Folder</h2>
      <button
        onClick={() => void pickWorkspaceFolder()}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-300"
      >
        <FolderOpen size={15} /> Choose Empty Folder
      </button>
      <p className="mt-1 text-[11px] text-zinc-600">
        Everything for this audiobook lives here: the copied source, the
        narration text, generated audio, and final exports.
      </p>
      {workspacePath && (
        <p className="mt-2 truncate rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-emerald-300" title={workspacePath}>
          {workspacePath}
        </p>
      )}

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
        {importing ? "Importing..." : "Import Manuscript"}
      </button>
    </div>
  );
}
