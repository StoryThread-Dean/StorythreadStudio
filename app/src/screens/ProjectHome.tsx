// ProjectHome.tsx -- The Welcome / Project Picker Screen
// =========================================================
// This is the first screen the writer sees when StoryForge opens.
// It supports three main flows:
//   1. Create or open a standalone project (single book, no series)
//   2. Create a new book series (folder with series.json + canonical profiles)
//   3. Open a series, browse its books, create new books, or open a book
//
// All data flows through the FastAPI backend -- the frontend never touches
// the filesystem directly.

import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  ProjectInfo,
  CreateProjectPayload,
  OpenProjectPayload,
  SeriesInfo,
  CreateSeriesPayload,
  CreateBookInSeriesPayload,
  BookListItem,
} from "../types/project";

const API_BASE = "http://localhost:8000";


interface ProjectHomeProps {
  onProjectOpen: (project: ProjectInfo) => void;
}


export function ProjectHome({ onProjectOpen }: ProjectHomeProps) {

  // Shared state
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Standalone project flow ────────────────────────────────────────────────
  const [newTitle, setNewTitle]               = useState("");
  const [newDescription, setNewDescription]   = useState("");
  const [newProjectStep, setNewProjectStep]   = useState<"idle" | "naming" | "creating">("idle");
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);

  // ── Series flow ────────────────────────────────────────────────────────────
  // "seriesStep" controls which sub-screen is shown:
  //   "idle"           = main menu
  //   "naming_series"  = entering series name and metadata
  //   "creating_series"= API call in progress
  //   "browsing"       = series is open, showing its books
  //   "naming_book"    = entering a new book title inside a series
  //   "creating_book"  = creating book API call in progress
  type SeriesStep = "idle" | "naming_series" | "creating_series" | "browsing" | "naming_book" | "creating_book";
  const [seriesStep, setSeriesStep]         = useState<SeriesStep>("idle");
  const [activeSeries, setActiveSeries]     = useState<SeriesInfo | null>(null);
  const [seriesBooks, setSeriesBooks]       = useState<BookListItem[]>([]);
  const [newSeriesName, setNewSeriesName]   = useState("");
  const [newSeriesGenre, setNewSeriesGenre] = useState("");
  const [newSeriesTone, setNewSeriesTone]   = useState("");
  const [newBookTitle, setNewBookTitle]     = useState("");
  const [newBookDesc, setNewBookDesc]       = useState("");
  const [seriesFolderPath, setSeriesFolderPath] = useState<string | null>(null);


  // ── Standalone Project Handlers ────────────────────────────────────────────

  async function handleNewProjectPickFolder() {
    setError(null);
    const selected = await openDialog({ directory: true, multiple: false, title: "Choose a folder for your new project" });
    if (!selected || typeof selected !== "string") return;
    setPendingFolderPath(selected);
    setNewTitle("");
    setNewDescription("");
    setNewProjectStep("naming");
  }

  async function handleNewProjectCreate() {
    if (!pendingFolderPath || !newTitle.trim()) return;
    setNewProjectStep("creating");
    setError(null);
    setLoading(true);
    try {
      const payload: CreateProjectPayload = {
        folder_path: pendingFolderPath,
        title: newTitle.trim(),
        description: newDescription.trim(),
      };
      const res = await fetch(`${API_BASE}/api/projects/create`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail ?? "Failed to create project."); }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setNewProjectStep("naming");
    } finally { setLoading(false); }
  }

  async function handleOpenProject() {
    setError(null);
    const selected = await openDialog({ directory: true, multiple: false, title: "Select your StoryForge project folder" });
    if (!selected || typeof selected !== "string") return;
    setLoading(true);
    try {
      const payload: OpenProjectPayload = { folder_path: selected };
      const res = await fetch(`${API_BASE}/api/projects/open`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail ?? "Failed to open project."); }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally { setLoading(false); }
  }

  function handleCancelNaming() {
    setNewProjectStep("idle");
    setPendingFolderPath(null);
    setNewTitle("");
    setNewDescription("");
    setError(null);
  }


  // ── Series Handlers ────────────────────────────────────────────────────────

  async function handleNewSeriesPickFolder() {
    setError(null);
    const selected = await openDialog({ directory: true, multiple: false, title: "Choose a parent folder for your new series" });
    if (!selected || typeof selected !== "string") return;
    setSeriesFolderPath(selected);
    setNewSeriesName("");
    setNewSeriesGenre("");
    setNewSeriesTone("");
    setSeriesStep("naming_series");
  }

  async function handleCreateSeries() {
    if (!seriesFolderPath || !newSeriesName.trim()) return;
    setSeriesStep("creating_series");
    setError(null);
    setLoading(true);
    try {
      const payload: CreateSeriesPayload = {
        folder_path: seriesFolderPath,
        name: newSeriesName.trim(),
        genre: newSeriesGenre.trim(),
        tone: newSeriesTone.trim(),
      };
      const res = await fetch(`${API_BASE}/api/series/create`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail ?? "Failed to create series."); }
      const series: SeriesInfo = await res.json();
      setActiveSeries(series);
      setSeriesBooks([]);
      setSeriesStep("browsing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setSeriesStep("naming_series");
    } finally { setLoading(false); }
  }

  async function handleOpenSeries() {
    setError(null);
    const selected = await openDialog({ directory: true, multiple: false, title: "Select your StoryForge series folder" });
    if (!selected || typeof selected !== "string") return;
    setLoading(true);
    try {
      // Open the series
      const res = await fetch(`${API_BASE}/api/series/open`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: selected }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail ?? "Failed to open series."); }
      const series: SeriesInfo = await res.json();
      setActiveSeries(series);

      // List its books
      const booksRes = await fetch(`${API_BASE}/api/series/list-books`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_path: series.root_path }),
      });
      if (booksRes.ok) {
        const booksData = await booksRes.json();
        setSeriesBooks(booksData.books ?? []);
      }
      setSeriesStep("browsing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally { setLoading(false); }
  }

  async function handleOpenBookFromSeries(book: BookListItem) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/open`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: book.root_path }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail ?? "Failed to open book."); }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally { setLoading(false); }
  }

  async function handleCreateBookInSeries() {
    if (!activeSeries || !newBookTitle.trim()) return;
    setSeriesStep("creating_book");
    setError(null);
    setLoading(true);
    try {
      const payload: CreateBookInSeriesPayload = {
        series_path: activeSeries.root_path,
        title: newBookTitle.trim(),
        description: newBookDesc.trim(),
      };
      const res = await fetch(`${API_BASE}/api/projects/create-in-series`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail ?? "Failed to create book."); }
      const project: ProjectInfo = await res.json();
      onProjectOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setSeriesStep("browsing");
    } finally { setLoading(false); }
  }

  function handleBackToMain() {
    setSeriesStep("idle");
    setNewProjectStep("idle");
    setActiveSeries(null);
    setSeriesBooks([]);
    setError(null);
  }


  // ── Render ─────────────────────────────────────────────────────────────────
  // Determine which sub-screen to show based on newProjectStep and seriesStep
  const isMainMenu = newProjectStep === "idle" && seriesStep === "idle";

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#070724] text-[#f0f0f5]">

      {/* App title */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-semibold tracking-wide text-[#f0f0f5]">
          StoryForge
        </h1>
        <p className="mt-2 text-sm text-[#8888aa]">
          Your local writing workspace
        </p>
      </div>


      {/* ── Main Menu ─────────────────────────────────────────────────────── */}
      {isMainMenu && (
        <div className="flex w-full max-w-sm flex-col gap-4">

          {/* Standalone Project section */}
          <p className="text-xs font-medium uppercase tracking-wide text-[#3f3f7a]">Standalone Project</p>

          <button
            onClick={handleNewProjectPickFolder}
            disabled={loading}
            className="rounded-lg border border-indigo-500 bg-indigo-600 px-6 py-4 text-left transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-white">New Project</p>
            <p className="mt-0.5 text-xs text-indigo-200">
              Set up a fresh project with the full StoryForge folder structure
            </p>
          </button>

          <button
            onClick={handleOpenProject}
            disabled={loading}
            className="rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] px-6 py-4 text-left transition-colors hover:border-indigo-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-[#f0f0f5]">Open Project</p>
            <p className="mt-0.5 text-xs text-[#8888aa]">
              Open a folder that already contains a StoryForge project
            </p>
          </button>

          {/* Series section */}
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-[#3f3f7a]">Book Series</p>

          <button
            onClick={handleNewSeriesPickFolder}
            disabled={loading}
            className="rounded-lg border border-teal-600 bg-teal-700/80 px-6 py-4 text-left transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-white">New Series</p>
            <p className="mt-0.5 text-xs text-teal-200">
              Create a series folder with shared profiles for multiple books
            </p>
          </button>

          <button
            onClick={handleOpenSeries}
            disabled={loading}
            className="rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] px-6 py-4 text-left transition-colors hover:border-teal-600 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-[#f0f0f5]">Open Series</p>
            <p className="mt-0.5 text-xs text-[#8888aa]">
              Open a series folder to browse its books or add new ones
            </p>
          </button>

          {loading && (
            <p className="text-center text-xs text-[#8888aa]">Loading...</p>
          )}
        </div>
      )}


      {/* ── Naming Standalone Project ─────────────────────────────────────── */}
      {(newProjectStep === "naming" || newProjectStep === "creating") && (
        <div className="w-full max-w-sm rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] p-6">
          <h2 className="mb-1 text-sm font-semibold text-[#f0f0f5]">Name Your Project</h2>
          <p className="mb-5 text-xs text-[#8888aa]">
            Folder: <span className="text-[#f0f0f5]">{pendingFolderPath}</span>
          </p>

          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Project Title <span className="text-indigo-400">*</span>
          </label>
          <input
            type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleNewProjectCreate()}
            placeholder="e.g. The Ember Chronicles" autoFocus
            className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />

          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Description <span className="text-[#3f3f7a]">(optional)</span>
          </label>
          <input
            type="text" value={newDescription} onChange={e => setNewDescription(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleNewProjectCreate()}
            placeholder="A short description of your story"
            className="mb-5 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />

          <div className="flex gap-3">
            <button
              onClick={handleNewProjectCreate}
              disabled={!newTitle.trim() || loading}
              className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Project"}
            </button>
            <button
              onClick={handleCancelNaming}
              disabled={loading}
              className="rounded border border-[#1e1e4a] px-4 py-2 text-sm text-[#8888aa] transition-colors hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}


      {/* ── Naming New Series ─────────────────────────────────────────────── */}
      {(seriesStep === "naming_series" || seriesStep === "creating_series") && (
        <div className="w-full max-w-sm rounded-lg border border-teal-800/50 bg-[#0d0d2b] p-6">
          <h2 className="mb-1 text-sm font-semibold text-teal-200">Create New Series</h2>
          <p className="mb-5 text-xs text-[#8888aa]">
            Parent folder: <span className="text-[#f0f0f5]">{seriesFolderPath}</span>
          </p>

          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Series Name <span className="text-teal-400">*</span>
          </label>
          <input
            type="text" value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreateSeries()}
            placeholder="e.g. The Ember Throne Saga" autoFocus
            className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />

          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Genre <span className="text-[#3f3f7a]">(optional)</span>
          </label>
          <input
            type="text" value={newSeriesGenre} onChange={e => setNewSeriesGenre(e.target.value)}
            placeholder="e.g. epic fantasy, sci-fi thriller"
            className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />

          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Tone <span className="text-[#3f3f7a]">(optional)</span>
          </label>
          <input
            type="text" value={newSeriesTone} onChange={e => setNewSeriesTone(e.target.value)}
            placeholder="e.g. dark, atmospheric, slow burn"
            className="mb-5 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />

          <div className="flex gap-3">
            <button
              onClick={handleCreateSeries}
              disabled={!newSeriesName.trim() || loading}
              className="flex-1 rounded bg-teal-700 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Series"}
            </button>
            <button
              onClick={handleBackToMain}
              disabled={loading}
              className="rounded border border-[#1e1e4a] px-4 py-2 text-sm text-[#8888aa] transition-colors hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}


      {/* ── Series Browser -- list books, add new book ────────────────────── */}
      {(seriesStep === "browsing" || seriesStep === "naming_book" || seriesStep === "creating_book") && activeSeries && (
        <div className="w-full max-w-md rounded-lg border border-teal-800/50 bg-[#0d0d2b] p-6">

          {/* Series header */}
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-teal-200">{activeSeries.name}</h2>
              <p className="mt-0.5 text-xs text-[#8888aa]">
                {activeSeries.genre && <span>{activeSeries.genre}</span>}
                {activeSeries.tone && <span> -- {activeSeries.tone}</span>}
                {!activeSeries.genre && !activeSeries.tone && "Book series"}
              </p>
            </div>
            <button
              onClick={handleBackToMain}
              className="rounded border border-[#1e1e4a] px-2 py-1 text-xs text-[#8888aa] hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
            >
              Back
            </button>
          </div>

          {/* Book list */}
          {seriesBooks.length === 0 && seriesStep === "browsing" && (
            <p className="mb-4 text-xs text-[#3f3f7a]">
              No books yet. Create the first book in this series.
            </p>
          )}

          {seriesBooks.length > 0 && (
            <div className="mb-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[#3f3f7a]">Books</p>
              {seriesBooks.map(book => (
                <button
                  key={book.project_id}
                  onClick={() => handleOpenBookFromSeries(book)}
                  disabled={loading}
                  className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-4 py-3 text-left transition-colors hover:border-teal-600 hover:bg-[#1a1a3e] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="text-sm font-medium text-[#f0f0f5]">{book.title}</p>
                  <p className="mt-0.5 text-xs text-[#3f3f7a]">{book.folder_name}</p>
                </button>
              ))}
            </div>
          )}

          {/* New Book form (inline) */}
          {seriesStep === "browsing" && (
            <button
              onClick={() => { setNewBookTitle(""); setNewBookDesc(""); setSeriesStep("naming_book"); }}
              disabled={loading}
              className="w-full rounded border border-dashed border-teal-700/50 px-4 py-3 text-left text-xs text-teal-400 transition-colors hover:border-teal-500 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Add a new book to this series
            </button>
          )}

          {(seriesStep === "naming_book" || seriesStep === "creating_book") && (
            <div className="mt-2 rounded border border-teal-800/30 bg-[#070724] p-4">
              <p className="mb-3 text-xs font-medium text-teal-300">New Book</p>

              <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                Book Title <span className="text-teal-400">*</span>
              </label>
              <input
                type="text" value={newBookTitle} onChange={e => setNewBookTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreateBookInSeries()}
                placeholder="e.g. The Ashen Crown" autoFocus
                className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />

              <label className="mb-1 block text-xs font-medium text-[#8888aa]">
                Description <span className="text-[#3f3f7a]">(optional)</span>
              </label>
              <input
                type="text" value={newBookDesc} onChange={e => setNewBookDesc(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreateBookInSeries()}
                placeholder="A short description of this book"
                className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />

              <div className="flex gap-3">
                <button
                  onClick={handleCreateBookInSeries}
                  disabled={!newBookTitle.trim() || loading}
                  className="flex-1 rounded bg-teal-700 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create Book"}
                </button>
                <button
                  onClick={() => setSeriesStep("browsing")}
                  disabled={loading}
                  className="rounded border border-[#1e1e4a] px-4 py-2 text-sm text-[#8888aa] transition-colors hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading && (
            <p className="mt-3 text-center text-xs text-[#8888aa]">Loading...</p>
          )}
        </div>
      )}


      {/* Error display */}
      {error && (
        <div className="mt-6 w-full max-w-sm rounded border border-red-800 bg-red-950/40 p-3">
          <p className="text-xs text-red-300">
            <span className="font-semibold">Error: </span>{error}
          </p>
          <p className="mt-1 text-xs text-red-400">
            Make sure the StoryForge backend is running on port 8000.
          </p>
        </div>
      )}

      {/* Tip */}
      <p className="absolute bottom-6 text-xs text-[#3f3f7a]">
        Projects and series are stored as plain Markdown files -- you can read and back them up anywhere.
      </p>
    </div>
  );
}
