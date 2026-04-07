// ProjectHome.tsx -- The Welcome / Project Picker Screen
// =========================================================
// This is the first screen the writer sees when StoryForge opens.
// It has two jobs:
//   1. Let the writer create a brand-new writing project
//   2. Let the writer open an existing one
//
// Flow for "New Project":
//   Click button → OS folder picker opens (via Tauri dialog plugin)
//   → writer picks/creates a folder → a dialog asks for the project title
//   → we call POST /api/projects/create on the backend
//   → backend creates the folder structure + project.json
//   → we pass the project info up to App.tsx via onProjectOpen()
//   → App.tsx switches to the editor view
//
// Flow for "Open Project":
//   Click button → OS folder picker opens → writer picks existing project folder
//   → we call POST /api/projects/open → backend reads project.json
//   → same handoff to App.tsx

import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { ProjectInfo, CreateProjectPayload, OpenProjectPayload } from "../types/project";

// The base URL for all API calls to our Python FastAPI backend.
// The backend runs locally on port 8000 when started with `uv run uvicorn ...`
const API_BASE = "http://localhost:8000";


// --- Props ---
// The only thing this screen needs from the outside world is a callback
// to call when a project is successfully opened or created.
// App.tsx passes this in and uses it to switch to the editor view.
interface ProjectHomeProps {
  onProjectOpen: (project: ProjectInfo) => void;
}


// ── ProjectHome Component ─────────────────────────────────────────────────────
export function ProjectHome({ onProjectOpen }: ProjectHomeProps) {

  // Error and loading state -- shown to the user if something goes wrong
  // or while we're waiting for the backend to respond.
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The project title entered during "New Project" flow
  const [newTitle, setNewTitle]           = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Which step of the "New Project" flow we're on:
  //   "idle"        = nothing happening
  //   "naming"      = folder was picked, waiting for the writer to enter a title
  //   "creating"    = API call in progress
  const [newProjectStep, setNewProjectStep]     = useState<"idle" | "naming" | "creating">("idle");
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);


  // --- New Project: Step 1 -- Pick a folder ---
  // Opens the OS native folder picker via the Tauri dialog plugin.
  // "await" pauses here until the user picks a folder (or cancels).
  async function handleNewProjectPickFolder() {
    setError(null);

    // open() from @tauri-apps/plugin-dialog shows the OS folder browser.
    // directory: true = only allow folder selection (not individual files)
    // multiple: false = only one folder at a time
    const selected = await openDialog({
      directory: true,
      multiple:  false,
      title:     "Choose a folder for your new project",
    });

    // If the user hit Cancel, `selected` is null -- do nothing
    if (!selected || typeof selected !== "string") return;

    // Store the path and move to the "naming" step
    setPendingFolderPath(selected);
    setNewTitle("");
    setNewDescription("");
    setNewProjectStep("naming");
  }


  // --- New Project: Step 2 -- Submit title and create ---
  // Called when the writer clicks "Create" after entering a project title.
  async function handleNewProjectCreate() {
    if (!pendingFolderPath || !newTitle.trim()) return;

    setNewProjectStep("creating");
    setError(null);
    setLoading(true);

    try {
      // Send the create request to the FastAPI backend.
      // fetch() is the browser's built-in HTTP client.
      // We use JSON.stringify to convert our JavaScript object to a JSON string.
      const payload: CreateProjectPayload = {
        folder_path: pendingFolderPath,
        title:       newTitle.trim(),
        description: newDescription.trim(),
      };

      const response = await fetch(`${API_BASE}/api/projects/create`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!response.ok) {
        // The backend returned an error -- parse the detail message and show it
        const errorData = await response.json();
        throw new Error(errorData.detail ?? "Failed to create project.");
      }

      // Success -- get the project info from the response and hand it to App.tsx
      const project: ProjectInfo = await response.json();
      onProjectOpen(project);

    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setNewProjectStep("naming"); // Go back so the user can try again
    } finally {
      setLoading(false);
    }
  }


  // --- Open Existing Project ---
  async function handleOpenProject() {
    setError(null);

    const selected = await openDialog({
      directory: true,
      multiple:  false,
      title:     "Select your StoryForge project folder",
    });

    if (!selected || typeof selected !== "string") return;

    setLoading(true);

    try {
      const payload: OpenProjectPayload = { folder_path: selected };

      const response = await fetch(`${API_BASE}/api/projects/open`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail ?? "Failed to open project.");
      }

      const project: ProjectInfo = await response.json();
      onProjectOpen(project);

    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }


  // --- Cancel new project naming ---
  function handleCancelNaming() {
    setNewProjectStep("idle");
    setPendingFolderPath(null);
    setNewTitle("");
    setNewDescription("");
    setError(null);
  }


  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // Full-screen dark background -- same as the editor
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


      {/* ── Normal state: Create or Open buttons ───────────────────────── */}
      {newProjectStep === "idle" && (
        <div className="flex w-full max-w-sm flex-col gap-4">

          {/* New Project button */}
          <button
            onClick={handleNewProjectPickFolder}
            disabled={loading}
            className="rounded-lg border border-indigo-500 bg-indigo-600 px-6 py-4 text-left transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Create a new writing project in a folder you choose"
          >
            <p className="text-sm font-semibold text-white">New Project</p>
            <p className="mt-0.5 text-xs text-indigo-200">
              Set up a fresh project with the full StoryForge folder structure
            </p>
          </button>

          {/* Open Project button */}
          <button
            onClick={handleOpenProject}
            disabled={loading}
            className="rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] px-6 py-4 text-left transition-colors hover:border-indigo-500 hover:bg-[#12122e] disabled:cursor-not-allowed disabled:opacity-50"
            title="Open an existing StoryForge project folder"
          >
            <p className="text-sm font-semibold text-[#f0f0f5]">Open Project</p>
            <p className="mt-0.5 text-xs text-[#8888aa]">
              Open a folder that already contains a StoryForge project
            </p>
          </button>

          {/* Loading indicator */}
          {loading && (
            <p className="text-center text-xs text-[#8888aa]">Opening project...</p>
          )}
        </div>
      )}


      {/* ── Naming step: enter project title before creating ───────────── */}
      {(newProjectStep === "naming" || newProjectStep === "creating") && (
        <div className="w-full max-w-sm rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] p-6">

          <h2 className="mb-1 text-sm font-semibold text-[#f0f0f5]">
            Name Your Project
          </h2>
          <p className="mb-5 text-xs text-[#8888aa]">
            Folder: <span className="text-[#f0f0f5]">{pendingFolderPath}</span>
          </p>

          {/* Project title input */}
          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Project Title <span className="text-indigo-400">*</span>
          </label>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleNewProjectCreate()}
            placeholder="e.g. The Ember Chronicles"
            autoFocus
            className="mb-4 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />

          {/* Optional description */}
          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Description <span className="text-[#3f3f7a]">(optional)</span>
          </label>
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleNewProjectCreate()}
            placeholder="A short description of your story"
            className="mb-5 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#8888aa] outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />

          {/* Action buttons */}
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


      {/* Error message -- shown below the buttons when something goes wrong */}
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


      {/* Tip at the bottom of the screen */}
      <p className="absolute bottom-6 text-xs text-[#3f3f7a]">
        💡 Tip: Projects are stored as plain Markdown files -- you can read and back them up anywhere.
      </p>

    </div>
  );
}
