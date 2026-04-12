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
// This follows the same overlay pattern used by Settings and ProjectSettings:
// fixed full-screen backdrop with a centered card on top.

import { useState } from "react";
import { X, FileText, Camera, CheckCircle, AlertCircle, Loader } from "lucide-react";
import type { ProjectInfo } from "../types/project";

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

  // --- Export Handlers ---

  const handleExport = async (exportType: "full-manuscript" | "snapshot") => {
    setIsExporting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/export/${exportType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: project.root_path }),
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

  // --- Render ---
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal card */}
      <div className="relative flex w-full max-w-md flex-col rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] shadow-2xl">

        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-[#1e1e4a]"
          style={{ padding: "1rem 1.5rem" }}
        >
          <h2 className="text-base font-semibold text-[#f0f0f5]">Export Manuscript</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-[#f0f0f5]"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "1.5rem" }} className="flex flex-col gap-4">

          {/* Export option: Full Manuscript */}
          <button
            onClick={() => handleExport("full-manuscript")}
            disabled={isExporting}
            className="flex items-start gap-3 rounded-lg border border-[#1e1e4a] p-4 text-left transition-colors hover:border-indigo-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={20} className="mt-0.5 shrink-0 text-indigo-400" />
            <div>
              <p className="text-sm font-medium text-[#f0f0f5]">Full Manuscript</p>
              <p className="mt-1 text-xs text-[#8888aa]">
                Combine all chapters into a single Markdown file. Overwrites the
                previous export so you always have one canonical copy.
              </p>
            </div>
          </button>

          {/* Export option: Snapshot */}
          <button
            onClick={() => handleExport("snapshot")}
            disabled={isExporting}
            className="flex items-start gap-3 rounded-lg border border-[#1e1e4a] p-4 text-left transition-colors hover:border-indigo-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera size={20} className="mt-0.5 shrink-0 text-indigo-400" />
            <div>
              <p className="text-sm font-medium text-[#f0f0f5]">Snapshot</p>
              <p className="mt-1 text-xs text-[#8888aa]">
                Save a dated copy of all chapters and project settings.
                Each snapshot is a new folder so you can look back at earlier versions.
              </p>
            </div>
          </button>

          {/* Loading indicator */}
          {isExporting && (
            <div className="flex items-center gap-2 text-xs text-[#8888aa]">
              <Loader size={14} className="animate-spin" />
              Exporting...
            </div>
          )}

          {/* Success message */}
          {result && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-emerald-300">{result.message}</p>
                  <p
                    className="mt-1 break-all font-mono text-xs text-emerald-400/70"
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
            <div className="rounded-lg border border-red-800 bg-red-950/40 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
