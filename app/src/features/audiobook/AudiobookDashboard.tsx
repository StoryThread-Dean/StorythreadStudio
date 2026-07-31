// features/audiobook/AudiobookDashboard.tsx
// ==========================================
// The Audiobook Converter's landing screen, redesigned (spec 5.1.1,
// user-designed): the FIRST look teaches what this tool is and how the
// workflow runs. Left column: headline, the five-step workflow strip
// (hover a step to expand its plain-terms explanation; step 5 carries
// pricing honesty), one primary [Let's Get Started] action, and a quiet
// More menu hiding Open Existing Workspace. Right column: Recent
// Activity -- returning writers just click their book.
//
// Visual identity per spec 5.0: deep jewel tones on dark charcoal --
// emerald = actions/success, sapphire = information/progress, ruby =
// costs/warnings/failures. Deliberately distinct from the writing app's
// palette so the writer always knows which side of the app they're in.

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookHeadphones, ChevronDown, FolderOpen, RefreshCw, Sparkles, X,
} from "lucide-react";

import { fetchProject, fetchRecents, removeRecent } from "./api";
import type { AudiobookProjectPayload, RecentAudiobook } from "./types";
import { AUDIOBOOK_STATUS_LABELS } from "./types";

// The five-step workflow strip: each step names itself; hovering (or
// focusing) expands the detail. The copy has three jobs at once -- say
// what this part of the app IS, teach the workflow, and carry the
// wonder of hearing your own words spoken. This is the new writer's
// first thirty seconds; it should read like an invitation, not a form.
// Each tile washes a faded gem color on the LEFT into charcoal on the
// right, and the gem shifts as the staircase descends: sapphire at the
// top, through violet at the midpoint, to ruby at the paid final step.
// Blue reads as "free and yours", ruby as "this one costs" -- the house
// palette's meanings, blended into one gradient.
const CHARCOAL = "#1a1a1a";

const WORKFLOW_STEPS: Array<{
  title: string; detail: string; gem: string; badge: string;
}> = [
  { gem: "#1e3a8a", badge: "bg-blue-500 text-white",
    title: "Load your book",
    detail: "Start from one of your Storythread books, or bring in a "
      + "manuscript from anywhere: DOCX, EPUB, Markdown, plain text. "
      + "Storythread copies it in and never touches your original, so "
      + "the words you wrote are never at risk." },
  { gem: "#312e81", badge: "bg-indigo-500 text-white",
    title: "Set up your workspace",
    detail: "Every audiobook gets a home of its own, suggested for "
      + "you: a folder beside the book it came from. Narration text, "
      + "generated audio, and finished files all live there together, "
      + "yours on your own drive." },
  { gem: "#4c1d95", badge: "bg-violet-500 text-white",
    title: "Direct the narration",
    detail: "Here a reading becomes a performance. Put a pause where a "
      + "reader would breathe, slow a heavy moment, quicken a fight, "
      + "and teach the narrator how your invented names are meant to "
      + "sound. Every marker comes with an audible example, and a "
      + "guided walkthrough will find the beats with you." },
  { gem: "#701a45", badge: "bg-pink-500 text-white",
    title: "Hear it read aloud, free",
    detail: "The built-in narrator reads your whole book on this "
      + "computer. No account, no meter, no limit. Listen to your own "
      + "chapters spoken back to you, adjust, and regenerate as often "
      + "as you like, then export chapter MP3s or a proper M4B "
      + "audiobook." },
  { gem: "#7f1d1d", badge: "bg-red-500 text-white",
    title: "(Optional) Print a studio-quality version",
    detail: "When the draft sounds the way you hear it in your head, "
      + "print the final with a premium AI voice. Honest numbers: "
      + "hosted draft voices run about fifty cents for a whole book, "
      + "top-tier narration costs meaningfully more, and you will "
      + "always see the price before a cent is spent. Arriving in the "
      + "premium update." },
];

interface AudiobookDashboardProps {
  /** Start the import wizard (New Audiobook). */
  onNewAudiobook: () => void;
  /** A workspace was opened (from Recents or the folder picker). */
  onOpenWorkspace: (payload: AudiobookProjectPayload) => void;
}

/** Status pill color by meaning: emerald done, sapphire active, ruby bad. */
function statusClasses(status: string): string {
  if (status === "completed") return "border-emerald-500/70 bg-emerald-950/70 text-emerald-300";
  if (status === "failed" || status === "export_only") return "border-rose-500/70 bg-rose-950/70 text-rose-300";
  if (status === "generating" || status === "paused") return "border-sky-500/70 bg-sky-950/70 text-sky-300";
  return "border-zinc-600 bg-zinc-800 text-zinc-300";
}

export function AudiobookDashboard({ onNewAudiobook, onOpenWorkspace }: AudiobookDashboardProps) {
  const [recents, setRecents] = useState<RecentAudiobook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const loadRecents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecents(await fetchRecents());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load recent audiobooks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecents(); }, [loadRecents]);

  // Open a workspace: fetch its manifest + chapters, hand the payload up.
  const openWorkspacePath = useCallback(async (workspacePath: string) => {
    setBusyPath(workspacePath);
    setError(null);
    try {
      onOpenWorkspace(await fetchProject(workspacePath));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that workspace.");
    } finally {
      setBusyPath(null);
    }
  }, [onOpenWorkspace]);

  // "Open Existing Audiobook Workspace": native folder picker, then open.
  const handleOpenExisting = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Open an audiobook workspace folder",
    });
    if (typeof selected === "string" && selected) {
      await openWorkspacePath(selected);
    }
  }, [openWorkspacePath]);

  const handleRemove = useCallback(async (workspacePath: string) => {
    // Index row only -- the backend guarantees no files are touched.
    await removeRecent(workspacePath);
    void loadRecents();
  }, [loadRecents]);

  return (
    // The page itself carries a whisper of the product: charcoal on the
    // left washing into a deep, faded emerald on the right -- the same
    // emerald that means "go" everywhere else in this app.
    <div
      className="h-full w-full overflow-y-auto"
      style={{
        backgroundImage:
          `linear-gradient(to right, ${CHARCOAL} 35%, rgba(6, 78, 59, 0.38) 100%)`,
      }}
    >
    <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-10 px-8 py-10">
      {/* Left: what this is, how it works, and the one way in. */}
      <div className="min-w-[20rem] flex-1">
        <div className="mb-5 flex items-start gap-3">
          <BookHeadphones size={28} className="stw-pulse mt-1 shrink-0 text-emerald-300" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-50">Audiobook Generator</h1>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium text-emerald-200">
              Hear your own words read aloud.
              {/* A living equalizer: the page has a voice of its own. */}
              <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
                {[0, 0.18, 0.36, 0.12, 0.5, 0.28].map((delay, i) => (
                  <span
                    key={i}
                    className="stw-eq-bar w-[2px] rounded-full bg-emerald-400/80"
                    style={{ height: `${[10, 14, 7, 12, 9, 13][i]}px`,
                             "--stw-delay": `${delay}s` } as React.CSSProperties}
                  />
                ))}
              </span>
            </p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-zinc-400">
              The book you wrote becomes a real audiobook, narrated on
              this computer, free and unlimited, and yours to keep. You
              stay the director: you choose the voice, the pacing, and
              every breath the narrator takes.
            </p>
          </div>
        </div>

        {/* The five-step staircase: each step steps further in, so the
            eye walks down the workflow and lands on the button. */}
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
          Five steps from page to playback
        </p>
        <ol className="mb-5 space-y-1.5">
          {WORKFLOW_STEPS.map((step, index) => (
            <li
              key={step.title}
              style={{
                marginLeft: `${index * 1.4}rem`,
                // Faded gem on the left, washing into charcoal by the
                // right edge -- the color walks blue to ruby as the
                // staircase descends.
                backgroundImage:
                  `linear-gradient(to right, ${step.gem} 0%, ${CHARCOAL} 70%)`,
                borderColor: `${step.gem}`,
              }}
              className="group relative rounded-lg border px-3 py-2 transition-all duration-200 hover:z-20 hover:brightness-125"
              tabIndex={0}
            >
              <p className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
                <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold shadow-sm transition-transform duration-200 group-hover:scale-110 "
                  + step.badge}>
                  {index + 1}
                </span>
                {step.title}
              </p>
              {/* The detail FLOATS out over what follows -- expanding a
                  step must never shove the rest of the page around
                  (live finding: the button bobbed as the cursor moved). */}
              <div
                style={{ backgroundImage:
                  `linear-gradient(to right, ${step.gem} 0%, ${CHARCOAL} 85%)` }}
                className="pointer-events-none absolute left-0 right-0 top-full z-20 origin-top scale-y-95 rounded-b-lg border-x border-b border-inherit px-3 pb-2.5 pt-0.5 opacity-0 shadow-xl shadow-black/60 transition-all duration-200 group-hover:scale-y-100 group-hover:opacity-100 group-focus-within:scale-y-100 group-focus-within:opacity-100"
              >
                <p className="pl-[2.1rem] text-xs leading-relaxed text-zinc-200">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/* One primary action: the guided walkthrough that builds the
            workspace. Open Existing lives under the quiet More menu. */}
        {/* The staircase lands here. Its own tile, at a FIXED spot: the
            steps float their details, so nothing above can move it. */}
        <div
          className="relative mt-7 overflow-hidden rounded-xl border border-emerald-700/60 px-4 py-4"
          style={{ marginLeft: "7rem",
                   backgroundImage:
                     `linear-gradient(to right, rgba(6,78,59,0.55) 0%, ${CHARCOAL} 90%)` }}
        >
          {/* A soundwave riding the tile: the shape of a voice. */}
          <svg aria-hidden viewBox="0 0 240 40" preserveAspectRatio="none"
               className="pointer-events-none absolute inset-y-0 right-0 h-full w-40 text-emerald-400/25">
            <path fill="none" stroke="currentColor" strokeWidth="1.5"
                  d="M0 20 Q 10 4 20 20 T 40 20 T 60 20 Q 70 2 80 20 T 100 20 T 120 20 Q 130 8 140 20 T 160 20 T 180 20 Q 190 6 200 20 T 220 20 T 240 20" />
          </svg>
          <div className="relative flex flex-wrap items-start gap-3">
            <div>
              <button
                onClick={onNewAudiobook}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-950/60 transition-all duration-200 hover:bg-emerald-400 hover:shadow-emerald-900/60"
              >
                <Sparkles size={16} /> Let's Get Started
              </button>
              <p className="mt-1.5 text-[11px] text-zinc-300">
                A guided walkthrough that sets everything up for you.
              </p>
            </div>
            <div className="relative">
              <button
                onClick={() => setMoreOpen(v => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-600 px-3 py-3 text-xs text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-50"
              >
                More <ChevronDown size={12} />
              </button>
              {moreOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-600 bg-zinc-800 py-1 shadow-xl shadow-black/50">
                  <button
                    onClick={() => { setMoreOpen(false); void handleOpenExisting(); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-700 hover:text-emerald-300"
                  >
                    <FolderOpen size={13} /> Open Existing Workspace
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Recent Activity -- returning writers click their book.
          Wide enough that a real book title never gets cut off. */}
      <div className="w-[27rem] max-w-full shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-300">
            Recent Activity
          </h2>
          <button
            onClick={() => void loadRecents()}
            title="Refresh the list"
            className="rounded p-1 text-zinc-400 transition-colors hover:text-sky-300"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : recents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            Your first audiobook starts here. Let's Get Started walks
            you all the way through it.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-700/70 rounded-lg border border-zinc-700/80 bg-zinc-800/40">
            {recents.map(r => (
              <li key={r.workspace_path} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/70">
                <button
                  onClick={() => void openWorkspacePath(r.workspace_path)}
                  disabled={busyPath !== null}
                  className="min-w-0 flex-1 text-left disabled:opacity-50"
                  title={r.workspace_path}
                >
                  <p className="text-sm font-medium leading-snug text-zinc-50 hover:text-emerald-300">
                    {r.title || "Untitled Audiobook"}
                  </p>
                  <p className="truncate text-xs text-zinc-400">
                    {r.author ? `${r.author} · ` : ""}{r.workspace_path}
                  </p>
                </button>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClasses(r.status)}`}>
                  {AUDIOBOOK_STATUS_LABELS[r.status] ?? r.status}
                </span>
                <button
                  onClick={() => void handleRemove(r.workspace_path)}
                  title="Remove from Recents (keeps all files on disk)"
                  className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:text-rose-400"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
    </div>
  );
}
