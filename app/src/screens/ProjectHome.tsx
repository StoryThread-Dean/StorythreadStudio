// ProjectHome.tsx -- The Welcome / Project Picker Screen (Phase 6 redesign)
// =========================================================================
// First screen the writer sees on launch. Two-column layout:
//   Left  : New Project funnel (5 story-type tiles -> name + optional series
//           toggle -> create) and a single smart [Open Project] button.
//   Right : Recent Projects list, scrollable, with per-row remove.
//
// Story type drives the default outline template at creation time. The
// writer can swap templates later via the editor's [+ New Template] button,
// so this screen doesn't expose a template picker -- the choice rides on
// top of the story-type icon they clicked.
//
// All data flows through the FastAPI backend; the frontend never touches
// the filesystem directly.

import { useState, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen, BookText, Book, FileText, Library,
  X, ArrowLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ProjectInfo,
  CreateProjectPayload,
  SeriesInfo,
  CreateSeriesPayload,
  CreateBookInSeriesPayload,
  RecentProject,
  StoryType,
  InspectFolderResponse,
  InspectedBook,
} from "../types/project";
import { STORY_TYPE_LABELS } from "../types/project";
import { formatDateTime12h } from "../utils/dateFormat";

const API_BASE = "http://localhost:8000";


// ── Story type catalog ────────────────────────────────────────────────────────
// Single source of truth for the 5 story-type tiles. Order here is the order
// shown in the picker. Each tile renders icon + label + word range; hovering
// shows the longer hint via the title attribute on the button.
const STORY_TYPE_OPTIONS: {
  value: StoryType;
  icon:  LucideIcon;
  range: string;
  hint:  string;
}[] = [
  { value: "novel",          icon: BookOpen, range: "50k to 100k words",   hint: "Long-form fiction with subplots and worldbuilding." },
  { value: "novella",        icon: BookText, range: "18k to 40k",          hint: "Compressed three-act, single POV, tight focus." },
  { value: "novelette",      icon: Book,     range: "8k to 18k",           hint: "Five-stage structure (Freytag's Pyramid). Single arc." },
  { value: "short_story",    icon: FileText, range: "2k to 8k",            hint: "Pick from Seven-Point, Three-Act, In Medias Res, etc." },
  { value: "serial_fiction", icon: Library,  range: "1.5k to 5k chapters", hint: "Episodic installments with hooks and cliffhangers." },
];


interface ProjectHomeProps {
  onProjectOpen: (project: ProjectInfo) => void;
}


export function ProjectHome({ onProjectOpen }: ProjectHomeProps) {
  // ── Top-level UI mode ────────────────────────────────────────────────────
  // "main"           : tile picker + Open Project button
  // "create_form"    : a story type was chosen; show name + series toggle
  // "series_browser" : a series folder was opened via smart-detect; show books
  // "add_book_form"  : inside the series browser, adding a new book
  type Mode = "main" | "create_form" | "series_browser" | "add_book_form";
  const [mode, setMode] = useState<Mode>("main");

  // ── Shared status state ─────────────────────────────────────────────────
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Recent projects ─────────────────────────────────────────────────────
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/recent`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRecentProjects(Array.isArray(data) ? data : []))
      .catch(() => setRecentProjects([]));
  }, []);

  // ── Creation form fields ────────────────────────────────────────────────
  // selectedStoryType is the tile clicked. When null we're showing the tile
  // grid; when set we're showing the name + series toggle below the tiles.
  const [selectedStoryType, setSelectedStoryType] = useState<StoryType | null>(null);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  const [title, setTitle]                         = useState("");
  const [description, setDescription]             = useState("");
  const [isSeries, setIsSeries]                   = useState(false);
  const [seriesName, setSeriesName]               = useState("");
  const [seriesGenre, setSeriesGenre]             = useState("");
  const [seriesTone, setSeriesTone]               = useState("");
  const [seriesContentMode, setSeriesContentMode] = useState<"general" | "mature" | "explicit">("general");

  // ── Series browser state (after smart-open detects a series) ────────────
  const [browsedSeriesPath, setBrowsedSeriesPath]   = useState<string | null>(null);
  const [browsedSeriesName, setBrowsedSeriesName]   = useState<string>("");
  const [browsedSeriesBooks, setBrowsedSeriesBooks] = useState<InspectedBook[]>([]);


  // ── Handlers: helpers ────────────────────────────────────────────────────
  function resetCreateForm() {
    setSelectedStoryType(null);
    setPendingFolderPath(null);
    setTitle("");
    setDescription("");
    setIsSeries(false);
    setSeriesName("");
    setSeriesGenre("");
    setSeriesTone("");
    setSeriesContentMode("general");
  }

  function backToMain() {
    setMode("main");
    setError(null);
    resetCreateForm();
    setBrowsedSeriesPath(null);
    setBrowsedSeriesName("");
    setBrowsedSeriesBooks([]);
  }


  // ── Handler: pick a story type tile ─────────────────────────────────────
  // After picking a story type, the writer must choose a folder before the
  // form can save. We open the folder picker here so the form already has
  // the folder when it appears.
  async function handlePickStoryType(value: StoryType) {
    setError(null);
    const selected = await openDialog({
      directory: true, multiple: false,
      title: `Choose a folder for your new ${STORY_TYPE_LABELS[value]}`,
    });
    if (!selected || typeof selected !== "string") return;
    setSelectedStoryType(value);
    setPendingFolderPath(selected);
    setMode("create_form");
  }


  // ── Handler: create the project (standalone OR series + first book) ─────
  // The "Make this a series" toggle changes which endpoints we hit:
  //   - off: POST /api/projects/create
  //   - on : POST /api/series/create THEN POST /api/projects/create-in-series
  // Two sequential calls in the series case so both files end up consistent.
  async function handleCreate() {
    if (!selectedStoryType || !pendingFolderPath || !title.trim()) return;
    setError(null);
    setLoading(true);

    try {
      if (isSeries) {
        if (!seriesName.trim()) {
          throw new Error("Series name is required when 'Make this a series' is checked.");
        }
        // Step 1: create the series folder + series.json
        const seriesPayload: CreateSeriesPayload = {
          folder_path:  pendingFolderPath,
          name:         seriesName.trim(),
          genre:        seriesGenre.trim(),
          tone:         seriesTone.trim(),
          content_mode: seriesContentMode,
        };
        const seriesRes = await fetch(`${API_BASE}/api/series/create`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(seriesPayload),
        });
        if (!seriesRes.ok) {
          const e = await seriesRes.json();
          throw new Error(e.detail ?? "Failed to create series.");
        }
        const series: SeriesInfo = await seriesRes.json();

        // Step 2: create the first book inside the new series
        const bookPayload: CreateBookInSeriesPayload = {
          series_path: series.root_path,
          title:       title.trim(),
          description: description.trim(),
          story_type:  selectedStoryType,
        };
        const bookRes = await fetch(`${API_BASE}/api/projects/create-in-series`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bookPayload),
        });
        if (!bookRes.ok) {
          const e = await bookRes.json();
          throw new Error(e.detail ?? "Failed to create book in series.");
        }
        const project: ProjectInfo = await bookRes.json();
        onProjectOpen(project);
      } else {
        // Standalone path: single POST creates the project and its outline.
        const payload: CreateProjectPayload = {
          folder_path: pendingFolderPath,
          title:       title.trim(),
          description: description.trim(),
          story_type:  selectedStoryType,
        };
        const res = await fetch(`${API_BASE}/api/projects/create`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.detail ?? "Failed to create project.");
        }
        const project: ProjectInfo = await res.json();
        onProjectOpen(project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }


  // ── Handler: smart Open Project ─────────────────────────────────────────
  // One button covers both project and series folders. Backend tells us
  // which kind it is via /api/projects/inspect-folder; we route accordingly.
  async function handleOpen() {
    setError(null);
    const selected = await openDialog({
      directory: true, multiple: false,
      title: "Choose a project or series folder",
    });
    if (!selected || typeof selected !== "string") return;

    setLoading(true);
    try {
      const inspectRes = await fetch(
        `${API_BASE}/api/projects/inspect-folder?path=${encodeURIComponent(selected)}`,
      );
      if (!inspectRes.ok) {
        const e = await inspectRes.json();
        throw new Error(e.detail ?? "Could not inspect that folder.");
      }
      const data: InspectFolderResponse = await inspectRes.json();

      if (data.kind === "project") {
        // Open it directly. Use existing /api/projects/open for the side
        // effects (recent-projects tracking, root_path patching).
        const openRes = await fetch(`${API_BASE}/api/projects/open`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_path: data.path }),
        });
        if (!openRes.ok) {
          const e = await openRes.json();
          throw new Error(e.detail ?? "Failed to open project.");
        }
        const project: ProjectInfo = await openRes.json();
        onProjectOpen(project);
      } else if (data.kind === "series") {
        // Show the books-in-series picker. Inspect already returned the books.
        setBrowsedSeriesPath(data.path);
        setBrowsedSeriesName(data.title ?? "Series");
        setBrowsedSeriesBooks(data.books);
        setMode("series_browser");
      } else {
        throw new Error("This folder doesn't look like a StoryForge project or series.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }


  // ── Handler: open a book from the series browser ────────────────────────
  async function handleOpenBookFromBrowser(book: InspectedBook) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/open`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: book.root_path }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? "Failed to open book.");
      }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }


  // ── Handler: add a new book to the browsed series ───────────────────────
  // The writer is already inside a known series, so we skip the series toggle
  // and reuse the same story-type tile + name flow. Setting mode to
  // add_book_form swaps the right side of the screen accordingly.
  function handleStartAddBook() {
    resetCreateForm();
    setMode("add_book_form");
  }

  async function handleCreateBookInBrowsedSeries() {
    if (!browsedSeriesPath || !selectedStoryType || !title.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const payload: CreateBookInSeriesPayload = {
        series_path: browsedSeriesPath,
        title:       title.trim(),
        description: description.trim(),
        story_type:  selectedStoryType,
      };
      const res = await fetch(`${API_BASE}/api/projects/create-in-series`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? "Failed to create book in series.");
      }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }


  // ── Handler: open a recent project ──────────────────────────────────────
  async function handleOpenRecent(rp: RecentProject) {
    if (!rp.exists) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/open`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: rp.root_path }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? "Failed to open project.");
      }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open project.");
    } finally {
      setLoading(false);
    }
  }


  // ── Handler: remove a project from the recent list (no file deletion) ───
  // Backend endpoint already exists; this just wires it up. The confirm
  // wording is explicit about the no-file-deletion semantics so the writer
  // doesn't think this is a destructive action.
  async function handleRemoveRecent(rp: RecentProject) {
    const confirmed = window.confirm(
      "Remove this project from the recent list?\n\n" +
      "This does NOT delete the folder or any files on disk. " +
      "It only removes the entry from this list. " +
      "If the folder still exists, you can restore it later by using Open Project.\n\n" +
      "If you also want to delete the folder, do that yourself in your file explorer."
    );
    if (!confirmed) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/projects/recent/${encodeURIComponent(rp.project_id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? "Failed to remove from recent list.");
      }
      // Local update -- avoids a refetch round-trip.
      setRecentProjects(prev => prev.filter(p => p.project_id !== rp.project_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove from list.");
    }
  }


  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-[#070724] text-[#f0f0f5]">

      {/* Title bar */}
      <div className="shrink-0 border-b border-[#1e1e4a] bg-[#0d0d2b] px-6 py-4">
        <h1 className="text-2xl font-semibold tracking-wide text-[#f0f0f5]">StoryForge</h1>
        <p className="mt-0.5 text-xs text-[#8888aa]">Your local writing workspace</p>
      </div>

      {/* Two-column body. min-h-0 + overflow on inner scrolls keeps the two
          columns independently scrollable. */}
      <div className="flex min-h-0 flex-1">

        {/* ── Left column: New Project / Open / Series browser ───────── */}
        <section className="flex w-3/5 min-w-0 flex-col overflow-y-auto border-r border-[#1e1e4a] p-8">

          {/* Main mode: tile picker + open button */}
          {mode === "main" && (
            <>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-[#a5b4fc]">
                New Project
              </h2>
              <p className="mb-5 text-xs text-[#8888aa]">
                Pick the kind of story you're starting. The outline scaffold is
                chosen automatically; you can swap it later from the editor.
              </p>

              {/* Story type tiles */}
              <div className="grid grid-cols-3 gap-3">
                {STORY_TYPE_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handlePickStoryType(opt.value)}
                      disabled={loading}
                      title={opt.hint}
                      className="flex flex-col items-start gap-1 rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] p-4 text-left transition-colors hover:border-indigo-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon size={22} className="text-indigo-400" />
                      <p className="mt-1 text-sm font-semibold text-[#f0f0f5]">
                        {STORY_TYPE_LABELS[opt.value]}
                      </p>
                      <p className="text-xs text-[#8888aa]">{opt.range}</p>
                    </button>
                  );
                })}
              </div>

              {/* Divider + Open Project */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-[#1e1e4a]" />
                <span className="text-xs text-[#3f3f7a]">or</span>
                <div className="h-px flex-1 bg-[#1e1e4a]" />
              </div>

              <button
                onClick={handleOpen}
                disabled={loading}
                className="self-start rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] px-5 py-3 text-left transition-colors hover:border-indigo-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
                title="Open an existing project or series folder"
              >
                <p className="text-sm font-semibold text-[#f0f0f5]">Open Project</p>
                <p className="mt-0.5 text-xs text-[#8888aa]">
                  Opens a folder. Detects whether it's a project or a series.
                </p>
              </button>
            </>
          )}

          {/* Create form: shown after a tile is picked */}
          {mode === "create_form" && selectedStoryType && (
            <>
              <button
                onClick={backToMain}
                className="mb-4 inline-flex items-center gap-1 self-start text-xs text-[#8888aa] hover:text-indigo-300"
              >
                <ArrowLeft size={12} /> Back
              </button>

              <h2 className="mb-1 text-sm font-semibold text-[#f0f0f5]">
                New {STORY_TYPE_LABELS[selectedStoryType]}
              </h2>
              <p className="mb-4 text-xs text-[#8888aa]">
                Folder: <span className="text-[#f0f0f5]">{pendingFolderPath}</span>
              </p>

              <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                Title <span className="text-indigo-400">*</span>
              </label>
              <input
                type="text" value={title} onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !isSeries) handleCreate(); }}
                placeholder="e.g. The Ember Chronicles" autoFocus
                className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />

              <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                Description <span className="text-[#3f3f7a]">(optional)</span>
              </label>
              <input
                type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="A short description of your story"
                className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />

              {/* Series toggle + inline expansion. When checked the series
                  fields slide in below the checkbox. */}
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-[#f0f0f5]">
                <input
                  type="checkbox" checked={isSeries}
                  onChange={e => setIsSeries(e.target.checked)}
                  className="accent-teal-500"
                />
                Make this a series
              </label>
              <p className="mb-3 ml-6 text-xs text-[#8888aa]">
                Creates a series folder around this book. You can add more
                books to it later from the Open Project flow.
              </p>

              {isSeries && (
                <div className="ml-6 mb-4 rounded border border-teal-800/40 bg-[#0d0d2b] p-4">
                  <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                    Series Name <span className="text-teal-400">*</span>
                  </label>
                  <input
                    type="text" value={seriesName} onChange={e => setSeriesName(e.target.value)}
                    placeholder="e.g. The Ember Throne Saga"
                    className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />

                  <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                    Genre <span className="text-[#3f3f7a]">(optional)</span>
                  </label>
                  <input
                    type="text" value={seriesGenre} onChange={e => setSeriesGenre(e.target.value)}
                    placeholder="e.g. epic fantasy"
                    className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />

                  <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                    Tone <span className="text-[#3f3f7a]">(optional)</span>
                  </label>
                  <input
                    type="text" value={seriesTone} onChange={e => setSeriesTone(e.target.value)}
                    placeholder="e.g. dark, atmospheric"
                    className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />

                  <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                    Content Mode
                  </label>
                  <select
                    value={seriesContentMode}
                    onChange={e => setSeriesContentMode(e.target.value as "general" | "mature" | "explicit")}
                    className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="general">General</option>
                    <option value="mature">Mature</option>
                    <option value="explicit">Explicit</option>
                  </select>
                  <p className="mt-1 text-xs text-[#3f3f7a]">
                    Books in this series will inherit this content mode by default.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={!title.trim() || (isSeries && !seriesName.trim()) || loading}
                  className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={backToMain}
                  disabled={loading}
                  className="rounded border border-[#1e1e4a] px-4 py-2 text-sm text-[#8888aa] transition-colors hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* Series browser: shown after smart-open detects a series folder */}
          {mode === "series_browser" && browsedSeriesPath && (
            <>
              <button
                onClick={backToMain}
                className="mb-4 inline-flex items-center gap-1 self-start text-xs text-[#8888aa] hover:text-indigo-300"
              >
                <ArrowLeft size={12} /> Back
              </button>

              <h2 className="mb-1 text-sm font-semibold text-teal-200">{browsedSeriesName}</h2>
              <p className="mb-5 text-xs text-[#8888aa]">
                {browsedSeriesPath}
              </p>

              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#3f3f7a]">
                Books in this series
              </p>

              {browsedSeriesBooks.length === 0 ? (
                <p className="mb-4 text-xs text-[#3f3f7a]">
                  No books yet. Create the first book below.
                </p>
              ) : (
                <div className="mb-4 flex flex-col gap-2">
                  {browsedSeriesBooks.map(book => (
                    <button
                      key={book.project_id || book.folder_name}
                      onClick={() => handleOpenBookFromBrowser(book)}
                      disabled={loading}
                      className="rounded border border-[#1e1e4a] bg-[#0d0d2b] px-4 py-3 text-left transition-colors hover:border-teal-600 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <p className="text-sm font-medium text-[#f0f0f5]">{book.title}</p>
                      <p className="mt-0.5 text-xs text-[#3f3f7a]">{book.folder_name}</p>
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={handleStartAddBook}
                disabled={loading}
                className="self-start rounded border border-dashed border-teal-700/60 px-4 py-2 text-xs text-teal-300 transition-colors hover:border-teal-500 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Add a new book to this series
              </button>
            </>
          )}

          {/* Add-book form: pick a story type for the new book in the series.
              Same tile picker as creation, but no series toggle (we know the
              parent series already). */}
          {mode === "add_book_form" && (
            <>
              <button
                onClick={() => setMode("series_browser")}
                className="mb-4 inline-flex items-center gap-1 self-start text-xs text-[#8888aa] hover:text-indigo-300"
              >
                <ArrowLeft size={12} /> Back to series
              </button>

              <h2 className="mb-1 text-sm font-semibold text-teal-200">
                New Book in {browsedSeriesName}
              </h2>

              {!selectedStoryType ? (
                <>
                  <p className="mb-4 text-xs text-[#8888aa]">Pick the kind of book you're starting.</p>
                  <div className="grid grid-cols-3 gap-3">
                    {STORY_TYPE_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setSelectedStoryType(opt.value)}
                          disabled={loading}
                          title={opt.hint}
                          className="flex flex-col items-start gap-1 rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] p-4 text-left transition-colors hover:border-teal-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Icon size={22} className="text-teal-300" />
                          <p className="mt-1 text-sm font-semibold text-[#f0f0f5]">
                            {STORY_TYPE_LABELS[opt.value]}
                          </p>
                          <p className="text-xs text-[#8888aa]">{opt.range}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-4 text-xs text-[#8888aa]">
                    Type: <span className="text-teal-200">{STORY_TYPE_LABELS[selectedStoryType]}</span>
                    <button
                      onClick={() => setSelectedStoryType(null)}
                      className="ml-2 text-[#3f3f7a] underline hover:text-[#8888aa]"
                    >
                      change
                    </button>
                  </p>

                  <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                    Title <span className="text-teal-400">*</span>
                  </label>
                  <input
                    type="text" value={title} onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreateBookInBrowsedSeries()}
                    placeholder="e.g. The Ashen Crown" autoFocus
                    className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />

                  <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                    Description <span className="text-[#3f3f7a]">(optional)</span>
                  </label>
                  <input
                    type="text" value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="A short description of this book"
                    className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />

                  <div className="flex gap-3">
                    <button
                      onClick={handleCreateBookInBrowsedSeries}
                      disabled={!title.trim() || loading}
                      className="flex-1 rounded bg-teal-700 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Creating..." : "Create Book"}
                    </button>
                    <button
                      onClick={() => setMode("series_browser")}
                      disabled={loading}
                      className="rounded border border-[#1e1e4a] px-4 py-2 text-sm text-[#8888aa] transition-colors hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* Error display lives at the bottom of the left column so it's
              visible regardless of which sub-mode is active. */}
          {error && (
            <div className="mt-6 rounded border border-red-800 bg-red-950/40 p-3">
              <p className="text-xs text-red-300">
                <span className="font-semibold">Error: </span>{error}
              </p>
              <p className="mt-1 text-xs text-red-400">
                Make sure the StoryForge backend is running on port 8000.
              </p>
            </div>
          )}
        </section>


        {/* ── Right column: Recent Projects ──────────────────────────── */}
        <aside className="flex w-2/5 min-w-0 flex-col overflow-y-auto bg-[#0a0a20] p-8">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-[#a5b4fc]">
            Recent Projects
          </h2>
          <p className="mb-5 text-xs text-[#8888aa]">
            Newest first. Click to open. Use [X] to remove from this list (does not delete files).
          </p>

          {recentProjects.length === 0 ? (
            <p className="text-xs text-[#3f3f7a]">No recent projects yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentProjects.map(rp => (
                <RecentProjectRow
                  key={rp.project_id}
                  rp={rp}
                  loading={loading}
                  onOpen={() => handleOpenRecent(rp)}
                  onRemove={() => handleRemoveRecent(rp)}
                />
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Footer tip */}
      <p className="shrink-0 border-t border-[#1e1e4a] bg-[#0d0d2b] px-6 py-2 text-xs text-[#3f3f7a]">
        Projects and series are stored as plain Markdown files. You can read and back them up anywhere.
      </p>
    </div>
  );
}


// ── RecentProjectRow ─────────────────────────────────────────────────────────
// One row in the right-side Recent Projects column. Pulled out as its own
// component to keep the main JSX scannable and to scope the [X] button's
// click handling so it doesn't bubble to the row's open click.

function RecentProjectRow({
  rp,
  loading,
  onOpen,
  onRemove,
}: {
  rp:       RecentProject;
  loading:  boolean;
  onOpen:   () => void;
  onRemove: () => void;
}) {
  const isMissing = !rp.exists;
  const lastOpened = formatDateTime12h(rp.last_opened);
  const storyLabel = STORY_TYPE_LABELS[rp.story_type] ?? "Project";

  return (
    <div
      className={`group relative rounded border px-3 py-2 transition-colors ${
        isMissing
          ? "border-[#1e1e4a] bg-[#0a0a1a] opacity-60"
          : "border-[#1e1e4a] bg-[#0d0d2b] hover:border-indigo-500 hover:bg-[#12122e]"
      }`}
    >
      {/* Open button covers the whole row except the X. We use a wrapping
          button instead of onClick on the div to keep keyboard focus/Enter
          working out of the box. */}
      <button
        onClick={onOpen}
        disabled={isMissing || loading}
        className="block w-full pr-7 text-left disabled:cursor-not-allowed"
        title={isMissing ? "Folder not found on disk" : `Open ${rp.title}`}
      >
        <p className={`truncate text-sm font-medium ${isMissing ? "text-[#3f3f7a]" : "text-[#f0f0f5]"}`}>
          {rp.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-[#8888aa]">
          <span>{storyLabel}</span>
          {rp.series_name && (
            <>
              <span className="mx-1 text-[#3f3f7a]">.</span>
              <span className="text-teal-400">Series: {rp.series_name}</span>
            </>
          )}
          {lastOpened && (
            <>
              <span className="mx-1 text-[#3f3f7a]">.</span>
              <span className="text-[#6666a0]">{lastOpened}</span>
            </>
          )}
        </p>
        {isMissing && (
          <p className="mt-0.5 text-xs text-red-400">(not found)</p>
        )}
      </button>

      {/* Remove from list. Tiny X in the top-right corner, always visible
          but slightly muted so it doesn't dominate. */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        disabled={loading}
        title="Remove from recent list (does not delete files)"
        aria-label="Remove from recent list"
        className="absolute right-1.5 top-1.5 rounded p-1 text-[#3f3f7a] transition-colors hover:bg-red-950/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X size={12} />
      </button>
    </div>
  );
}
