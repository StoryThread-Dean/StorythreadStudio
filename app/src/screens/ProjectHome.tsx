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

import { useState, useEffect, useCallback, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen, BookText, Book, FileText, Library,
  X, ArrowLeft, RefreshCw, Loader, AlertTriangle,
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
import { Wordmark } from "../components/Wordmark";

const API_BASE = "http://localhost:8000";


// Nothing answered at all -- as opposed to the backend answering with an
// error. Only this one is worth waiting out; see loadRecents below.
class Unreachable extends Error {}

// How long the dashboard keeps quietly retrying the recent-projects list
// before it tells the writer something is wrong.
//
// The installed app spawns the backend as a onefile PyInstaller exe, which
// unpacks itself to a temp folder on every launch while Defender reads the
// freshly written DLLs -- seconds, not milliseconds. A single attempt at mount
// loses that race more often than it wins it, which is exactly how a writer
// with six books came to be told they had none.
const RECENTS_POLL_MS    = 750;
const RECENTS_GIVE_UP_MS = 10_000;


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
  /** Open the Audiobook Converter -- a standalone tool, not a project. */
  onOpenAudiobooks: () => void;
}


export function ProjectHome({ onProjectOpen, onOpenAudiobooks }: ProjectHomeProps) {
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
  // `null` means "we have not managed to read the list yet" -- NOT "the list
  // is empty". Those were the same value here for a long time, and it caused
  // the bug this code is shaped around: on a cold start the backend has not
  // bound its port yet, the fetch was rejected, the catch set [], and the
  // column rendered "No recent projects yet." to a writer with six books.
  // Nothing retried, so it stayed wrong until they navigated away.
  //
  // Worse, the global backend-down banner is deliberately suppressed in
  // exactly that window (App.tsx only shows it once a ping has succeeded, to
  // avoid a flash on startup), so the writer got a confident wrong answer and
  // no warning at all. Hence a message local to this column.
  const [recentProjects, setRecentProjects] = useState<RecentProject[] | null>(null);
  const [recentsError,   setRecentsError]   = useState<string | null>(null);

  // Cancels an in-flight cold-start poll when the screen unmounts.
  const recentsPollRef = useRef<{ cancelled: boolean } | null>(null);

  const loadRecents = useCallback(async (opts?: { poll?: boolean }) => {
    // Retire any previous poll so two of them cannot fight over the state.
    if (recentsPollRef.current) recentsPollRef.current.cancelled = true;
    const token = { cancelled: false };
    recentsPollRef.current = token;

    setRecentsError(null);
    setRecentProjects(prev => (opts?.poll ? null : prev));

    const deadline = Date.now() + RECENTS_GIVE_UP_MS;

    // One attempt. Returns the entries, or throws with the best message we
    // can give -- the backend's own `detail` when it sent one, because a
    // corrupt recents file and an absent backend are different problems and
    // must not read identically.
    //
    // The two failures are also worth RETRYING differently, which is why
    // Unreachable is its own type. A rejected fetch means nothing answered:
    // the port is not bound yet, and waiting is the correct response. An HTTP
    // error means the backend is up and has given its answer, so retrying it
    // for ten seconds would just make the writer wait to be told something we
    // already know.
    const attempt = async (): Promise<RecentProject[]> => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/projects/recent`);
      } catch {
        throw new Unreachable("The backend service isn't responding.");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body?.detail === "string"
            ? body.detail
            : "The backend could not read your recent projects."
        );
      }
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("The recent projects list came back malformed.");
      return data as RecentProject[];
    };

    for (;;) {
      try {
        const data = await attempt();
        if (token.cancelled) return;
        setRecentProjects(data);
        setRecentsError(null);
        return;
      } catch (err) {
        if (token.cancelled) return;

        // Keep waiting only for a cold start we were asked to poll for, only
        // while nothing is answering, and only while there is time left.
        const keepWaiting =
          opts?.poll && err instanceof Unreachable && Date.now() < deadline;

        if (!keepWaiting) {
          setRecentProjects([]);
          setRecentsError(
            err instanceof Error ? err.message : "Could not load your recent projects."
          );
          return;
        }
        await new Promise(resolve => setTimeout(resolve, RECENTS_POLL_MS));
        if (token.cancelled) return;
      }
    }
  }, []);

  useEffect(() => {
    void loadRecents({ poll: true });
    return () => {
      if (recentsPollRef.current) recentsPollRef.current.cancelled = true;
    };
  }, [loadRecents]);

  // ── Vault root (where new projects are auto-placed) ─────────────────────
  // Fetched from settings so we can show the writer where the new project
  // folder will land. The backend is authoritative; we only display it here.
  const [vaultRoot, setVaultRoot] = useState<string>("");

  useEffect(() => {
    fetch(`${API_BASE}/api/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.vault_root) setVaultRoot(data.vault_root); })
      .catch(() => { /* non-fatal -- the hint just won't show a path */ });
  }, []);

  // ── Creation form fields ────────────────────────────────────────────────
  // selectedStoryType is the tile clicked. When null we're showing the tile
  // grid; when set we're showing the name + series toggle below the tiles.
  const [selectedStoryType, setSelectedStoryType] = useState<StoryType | null>(null);
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
  // Goes straight to the create form. The backend auto-derives the folder
  // under the configured vault root (default ~/Documents/Storythread Studio) using
  // a slugified title, so the writer never has to pick a folder. The hint
  // in the form tells them where the new project will land.
  function handlePickStoryType(value: StoryType) {
    setError(null);
    setSelectedStoryType(value);
    setMode("create_form");
  }


  // ── Handler: create the project (standalone OR series + first book) ─────
  // The "Make this a series" toggle changes which endpoints we hit:
  //   - off: POST /api/projects/create
  //   - on : POST /api/series/create THEN POST /api/projects/create-in-series
  // Two sequential calls in the series case so both files end up consistent.
  async function handleCreate() {
    if (!selectedStoryType || !title.trim()) return;
    setError(null);
    setLoading(true);

    try {
      if (isSeries) {
        if (!seriesName.trim()) {
          throw new Error("Series name is required when 'Make this a series' is checked.");
        }
        // Step 1: create the series folder + series.json. Empty folder_path
        // tells the backend to auto-derive under the vault root.
        const seriesPayload: CreateSeriesPayload = {
          folder_path:  "",
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
        // Empty folder_path lets the backend auto-derive under the vault root.
        const payload: CreateProjectPayload = {
          folder_path: "",
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
        throw new Error("This folder doesn't look like a Storythread Studio project or series.");
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
      // Local update -- avoids a refetch round-trip. Guarded because `null`
      // here means the list was never read; there is nothing to filter.
      setRecentProjects(prev => prev ? prev.filter(p => p.project_id !== rp.project_id) : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove from list.");
    }
  }


  // The book to offer on the hero: the most recently opened one that is
  // still where it was. `exists` is false when the folder has been moved or
  // deleted, and offering a button that cannot work is worse than offering
  // none. Recents arrive newest-first from the backend.
  // Optional-chained on purpose: while the list is still being read this is
  // undefined, so the hero stays hidden rather than briefly claiming there is
  // nothing to continue.
  const mostRecent = recentProjects?.find(rp => rp.exists);
  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-bg-primary text-text-primary">

      {/* ── The hero ─────────────────────────────────────────────────────
          The dashboard used to be a logo strip, a tagline, and two columns of
          boxes -- reported as generic and plain, which it was: nothing on it
          said what to do next, so a returning writer had to find their book
          in a list before they could start.

          So the band leads with the thing they came for. It is built ONLY
          from what this screen already fetched -- the recents list -- and it
          hides itself entirely when there is nothing to continue, so a first
          run still opens on the story-type picker rather than on an empty
          promise. */}
      <div className="shrink-0 border-b border-border bg-bg-panel shadow-e1">
        <Wordmark compact maxImageWidth={420} />

        <div className="flex flex-wrap items-center gap-4 px-8 pb-2.5 pt-1">
          <div className="min-w-0">
            <p className="text-xs text-text-muted">Your local writing workspace</p>
          </div>

          {mostRecent && (
            <button
              type="button"
              onClick={() => void handleOpenRecent(mostRecent)}
              data-testid="hero-continue"
              className="ml-auto flex min-w-0 items-center gap-3 rounded-lg border border-border bg-bg-surface px-4 py-2 text-left transition-colors hover:border-accent hover:bg-bg-raised"
            >
              <BookOpen size={18} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-micro uppercase tracking-label text-text-muted">
                  Continue where you left off
                </span>
                <span className="block truncate text-sm font-semibold text-text-primary">
                  {mostRecent.title}
                </span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Two-column body. min-h-0 + overflow on inner scrolls keeps the two
          columns independently scrollable. */}
      <div className="flex min-h-0 flex-1">

        {/* ── Left column: New Project / Open / Series browser ───────── */}
        <section className="flex w-3/5 min-w-0 flex-col overflow-y-auto border-r border-border p-8">

          {/* Main mode: tile picker + open button */}
          {mode === "main" && (
            <>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-accent">
                New Project
              </h2>
              <p className="mb-5 text-xs text-text-muted">
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
                      className="flex flex-col items-start gap-1 rounded-lg border border-border bg-bg-panel p-4 text-left transition-colors hover:border-accent-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon size={22} className="text-accent-muted" />
                      <p className="mt-1 text-sm font-semibold text-text-primary">
                        {STORY_TYPE_LABELS[opt.value]}
                      </p>
                      <p className="text-xs text-text-muted">{opt.range}</p>
                    </button>
                  );
                })}
              </div>

              {/* Divider + Open Project */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-faint">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <button
                onClick={handleOpen}
                disabled={loading}
                className="self-start rounded-lg border border-border bg-bg-panel px-5 py-3 text-left transition-colors hover:border-accent-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                title="Open an existing project or series folder"
              >
                <p className="text-sm font-semibold text-text-primary">Open Project</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Opens a folder. Detects whether it's a project or a series.
                </p>
              </button>

              {/* Audiobook Converter entry: a standalone tool with its own
                  dashboard, workspaces, and jewel-tone look -- a manuscript
                  does NOT need to be a Storythread project. The emerald
                  accent hints at the converter's own color world. */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-faint">tools</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <button
                onClick={onOpenAudiobooks}
                disabled={loading}
                className="self-start rounded-lg border border-border bg-bg-panel px-5 py-3 text-left transition-colors hover:border-success-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                title="Convert a manuscript into MP3 and M4B audiobooks"
              >
                <p className="text-sm font-semibold text-success-muted">Audiobook Converter</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Convert manuscripts into MP3 and M4B audiobooks.
                </p>
              </button>
            </>
          )}

          {/* Create form: shown after a tile is picked */}
          {mode === "create_form" && selectedStoryType && (
            <>
              <button
                onClick={backToMain}
                className="mb-4 inline-flex items-center gap-1 self-start text-xs text-text-muted hover:text-accent"
              >
                <ArrowLeft size={12} /> Back
              </button>

              <h2 className="mb-1 text-sm font-semibold text-text-primary">
                New {STORY_TYPE_LABELS[selectedStoryType]}
              </h2>
              <p className="mb-4 text-xs text-text-muted">
                Will be created under{" "}
                <span className="text-text-primary">{vaultRoot || "your vault folder"}</span>
                . You can change the vault location in Settings.
              </p>

              <label className="mb-1 block text-xs font-medium text-text-muted">
                Title <span className="text-accent-muted">*</span>
              </label>
              <input
                type="text" value={title} onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !isSeries) handleCreate(); }}
                placeholder="e.g. The Ember Chronicles" autoFocus
                className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent-fill focus:ring-1 focus:ring-accent-fill"
              />

              <label className="mb-1 block text-xs font-medium text-text-muted">
                Description <span className="text-faint">(optional)</span>
              </label>
              <input
                type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="A short description of your story"
                className="mb-4 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent-fill focus:ring-1 focus:ring-accent-fill"
              />

              {/* Series toggle + inline expansion. When checked the series
                  fields slide in below the checkbox. */}
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox" checked={isSeries}
                  onChange={e => setIsSeries(e.target.checked)}
                  className="accent-secondary-fill"
                />
                Make this a series
              </label>
              <p className="mb-3 ml-6 text-xs text-text-muted">
                Creates a series folder around this book. You can add more
                books to it later from the Open Project flow.
              </p>

              {isSeries && (
                <div className="ml-6 mb-4 rounded border border-secondary-fill/40 bg-bg-panel p-4">
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Series Name <span className="text-secondary-muted">*</span>
                  </label>
                  <input
                    type="text" value={seriesName} onChange={e => setSeriesName(e.target.value)}
                    placeholder="e.g. The Ember Throne Saga"
                    className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-secondary-fill focus:ring-1 focus:ring-secondary-fill"
                  />

                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Genre <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    type="text" value={seriesGenre} onChange={e => setSeriesGenre(e.target.value)}
                    placeholder="e.g. epic fantasy"
                    className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-secondary-fill focus:ring-1 focus:ring-secondary-fill"
                  />

                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Tone <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    type="text" value={seriesTone} onChange={e => setSeriesTone(e.target.value)}
                    placeholder="e.g. dark, atmospheric"
                    className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-secondary-fill focus:ring-1 focus:ring-secondary-fill"
                  />

                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Content Mode
                  </label>
                  <select
                    value={seriesContentMode}
                    onChange={e => setSeriesContentMode(e.target.value as "general" | "mature" | "explicit")}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-secondary-fill focus:ring-1 focus:ring-secondary-fill"
                  >
                    <option value="general">General</option>
                    <option value="mature">Mature</option>
                    <option value="explicit">Explicit</option>
                  </select>
                  <p className="mt-1 text-xs text-faint">
                    Books in this series will inherit this content mode by default.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={!title.trim() || (isSeries && !seriesName.trim()) || loading}
                  className="flex-1 rounded bg-accent-fill py-2 text-sm font-medium text-white transition-colors hover:bg-accent-fill disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={backToMain}
                  disabled={loading}
                  className="rounded border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:border-faint hover:text-text-primary"
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
                className="mb-4 inline-flex items-center gap-1 self-start text-xs text-text-muted hover:text-accent"
              >
                <ArrowLeft size={12} /> Back
              </button>

              <h2 className="mb-1 text-sm font-semibold text-secondary-strong">{browsedSeriesName}</h2>
              <p className="mb-5 text-xs text-text-muted">
                {browsedSeriesPath}
              </p>

              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
                Books in this series
              </p>

              {browsedSeriesBooks.length === 0 ? (
                <p className="mb-4 text-xs text-faint">
                  No books yet. Create the first book below.
                </p>
              ) : (
                <div className="mb-4 flex flex-col gap-2">
                  {browsedSeriesBooks.map(book => (
                    <button
                      key={book.project_id || book.folder_name}
                      onClick={() => handleOpenBookFromBrowser(book)}
                      disabled={loading}
                      className="rounded border border-border bg-bg-panel px-4 py-3 text-left transition-colors hover:border-secondary-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <p className="text-sm font-medium text-text-primary">{book.title}</p>
                      <p className="mt-0.5 text-xs text-faint">{book.folder_name}</p>
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={handleStartAddBook}
                disabled={loading}
                className="self-start rounded border border-dashed border-secondary-fill/60 px-4 py-2 text-xs text-secondary transition-colors hover:border-secondary-fill hover:text-secondary-strong disabled:cursor-not-allowed disabled:opacity-50"
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
                className="mb-4 inline-flex items-center gap-1 self-start text-xs text-text-muted hover:text-accent"
              >
                <ArrowLeft size={12} /> Back to series
              </button>

              <h2 className="mb-1 text-sm font-semibold text-secondary-strong">
                New Book in {browsedSeriesName}
              </h2>

              {!selectedStoryType ? (
                <>
                  <p className="mb-4 text-xs text-text-muted">Pick the kind of book you're starting.</p>
                  <div className="grid grid-cols-3 gap-3">
                    {STORY_TYPE_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setSelectedStoryType(opt.value)}
                          disabled={loading}
                          title={opt.hint}
                          className="flex flex-col items-start gap-1 rounded-lg border border-border bg-bg-panel p-4 text-left transition-colors hover:border-secondary-fill hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Icon size={22} className="text-secondary" />
                          <p className="mt-1 text-sm font-semibold text-text-primary">
                            {STORY_TYPE_LABELS[opt.value]}
                          </p>
                          <p className="text-xs text-text-muted">{opt.range}</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-4 text-xs text-text-muted">
                    Type: <span className="text-secondary-strong">{STORY_TYPE_LABELS[selectedStoryType]}</span>
                    <button
                      onClick={() => setSelectedStoryType(null)}
                      className="ml-2 text-faint underline hover:text-text-muted"
                    >
                      change
                    </button>
                  </p>

                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Title <span className="text-secondary-muted">*</span>
                  </label>
                  <input
                    type="text" value={title} onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreateBookInBrowsedSeries()}
                    placeholder="e.g. The Ashen Crown" autoFocus
                    className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-secondary-fill focus:ring-1 focus:ring-secondary-fill"
                  />

                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Description <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    type="text" value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="A short description of this book"
                    className="mb-4 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-secondary-fill focus:ring-1 focus:ring-secondary-fill"
                  />

                  <div className="flex gap-3">
                    <button
                      onClick={handleCreateBookInBrowsedSeries}
                      disabled={!title.trim() || loading}
                      className="flex-1 rounded bg-secondary-fill py-2 text-sm font-medium text-white transition-colors hover:bg-secondary-fill disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Creating..." : "Create Book"}
                    </button>
                    <button
                      onClick={() => setMode("series_browser")}
                      disabled={loading}
                      className="rounded border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:border-faint hover:text-text-primary"
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
            <div className="mt-6 rounded border border-danger-fill bg-danger-soft/40 p-3">
              <p className="text-xs text-danger">
                <span className="font-semibold">Error: </span>{error}
              </p>
              <p className="mt-1 text-xs text-danger-muted">
                Make sure the Storythread Studio backend is running on port 8000.
              </p>
            </div>
          )}
        </section>


        {/* ── Right column: Recent Projects ──────────────────────────── */}
        <aside className="flex w-2/5 min-w-0 flex-col overflow-y-auto bg-bg-primary p-8">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-accent">
              Recent Projects
            </h2>
            <button
              type="button"
              onClick={() => void loadRecents()}
              title="Refresh the list"
              aria-label="Refresh the recent projects list"
              className="rounded p-1 text-text-muted transition-colors hover:text-secondary"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <p className="mb-5 text-xs text-text-muted">
            Newest first. Click to open. Use [X] to remove from this list (does not delete files).
          </p>

          {/* The order of these branches is the fix. "Could not read the list"
              is checked FIRST, so the empty-state wording below is unreachable
              on a failure -- it used to be the only thing a failed load could
              produce, which is how the screen came to tell a writer with six
              books that they had none. */}
          {recentsError ? (
            <div
              role="alert"
              className="rounded border border-danger-fill bg-danger-soft/40 p-3"
            >
              <p className="text-xs text-danger">
                <AlertTriangle size={13} className="mr-1.5 inline" />
                Couldn't load your projects.
              </p>
              <p className="mt-1 text-xs text-danger-muted">{recentsError}</p>
              <button
                type="button"
                onClick={() => void loadRecents()}
                className="mt-2 rounded border border-danger-fill/60 bg-danger-soft/30 px-2 py-0.5 text-mini text-danger transition-colors hover:border-danger-fill hover:bg-danger-soft/40 hover:text-danger-strong"
              >
                Try again
              </button>
            </div>
          ) : recentProjects === null ? (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <Loader size={12} className="animate-spin" />
              Connecting to your library...
            </p>
          ) : recentProjects.length === 0 ? (
            <p className="text-xs text-faint">No recent projects yet.</p>
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
      <p className="shrink-0 border-t border-border bg-bg-panel px-6 py-2 text-xs text-faint">
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
          ? "border-border bg-bg-primary opacity-60"
          : "border-border bg-bg-panel hover:border-accent-fill hover:bg-bg-raised"
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
        <p className={`truncate text-sm font-medium ${isMissing ? "text-faint" : "text-text-primary"}`}>
          {rp.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-text-muted">
          <span>{storyLabel}</span>
          {rp.series_name && (
            <>
              <span className="mx-1 text-faint">.</span>
              <span className="text-secondary-muted">Series: {rp.series_name}</span>
            </>
          )}
          {lastOpened && (
            <>
              <span className="mx-1 text-faint">.</span>
              <span className="text-text-muted">{lastOpened}</span>
            </>
          )}
        </p>
        {isMissing && (
          <p className="mt-0.5 text-xs text-danger-muted">(not found)</p>
        )}
      </button>

      {/* Remove from list. Tiny X in the top-right corner, always visible
          but slightly muted so it doesn't dominate. */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        disabled={loading}
        title="Remove from recent list (does not delete files)"
        aria-label="Remove from recent list"
        className="absolute right-1.5 top-1.5 rounded p-1 text-faint transition-colors hover:bg-danger-soft/40 hover:text-danger-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X size={12} />
      </button>
    </div>
  );
}
