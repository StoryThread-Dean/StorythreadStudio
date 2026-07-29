// features/audiobook/GenerationPanel.tsx
// =======================================
// The right rail of the narration workspace: pick a narrator voice,
// preview it for free, generate the book, and watch/steer the run
// (pause / resume / cancel). Jewel semantics throughout: emerald for the
// generate action and completion, sapphire for live progress, ruby for
// failures.
//
// The panel polls /generation/status every 1.5s while a run is active --
// the same simple polling pattern as the backend-health hook; no
// streaming. Pause and cancel act BETWEEN segments, so the UI reflects
// them on the next poll, not instantly.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Loader2, Mic2, Pause, Play, Square } from "lucide-react";

import {
  cancelGeneration, fetchGenerationStatus, fetchVoices, pauseGeneration,
  previewSelection, previewVoice, resumeGeneration, startGeneration,
} from "./api";
import type { GenerationRun, NarratorVoice } from "./types";

interface GenerationPanelProps {
  workspacePath: string;
  /** Current editor selection (raw narration text incl. markers), "" when
      nothing is selected. Provided by WorkspaceView so the Preview
      Selection button can rehearse exactly what the writer highlighted. */
  getSelectionText?: () => string;
}

const PREVIEW_SAMPLE =
  "The road disappeared beneath the gathering snow, and somewhere behind " +
  "her, a second set of footsteps stopped.";

export function GenerationPanel({ workspacePath, getSelectionText }: GenerationPanelProps) {
  const [voices, setVoices] = useState<NarratorVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [engineState, setEngineState] = useState<"starting" | "ready" | "unavailable">("starting");
  const [engineError, setEngineError] = useState<string | null>(null);

  // Which preview is rendering right now. One at a time; the button that
  // was clicked spins, the OTHER shows a ban icon -- two spinners made it
  // look like both were running (live-testing feedback).
  const [previewing, setPreviewing] = useState<null | "voice" | "selection">(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [run, setRun] = useState<GenerationRun | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);          // a control call in flight
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  // ── Engine + voices (first call spawns the worker; can take a bit) ──────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchVoices();
        if (cancelled) return;
        setVoices(list);
        setVoiceId(prev => prev || (list[0]?.id ?? ""));
        setEngineState("ready");
      } catch (e) {
        if (cancelled) return;
        setEngineState("unavailable");
        setEngineError(e instanceof Error ? e.message : "Local narrator unavailable.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Status polling ───────────────────────────────────────────────────────
  const pollOnce = useCallback(async () => {
    try {
      const body = await fetchGenerationStatus(workspacePath);
      setRun(body.run);
      setActive(body.active);
      return body.active;
    } catch {
      return false;      // backend hiccup -- the banner system covers it
    }
  }, [workspacePath]);

  useEffect(() => {
    void pollOnce();     // pick up an existing/interrupted run on mount
  }, [pollOnce]);

  useEffect(() => {
    if (!active) {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    pollTimer.current = window.setInterval(() => { void pollOnce(); }, 1500);
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [active, pollOnce]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handlePreview = useCallback(async () => {
    if (!voiceId || previewing) return;
    setPreviewing("voice");
    setError(null);
    try {
      const blob = await previewVoice(PREVIEW_SAMPLE, voiceId, workspacePath);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setPreviewing(null);
    }
  }, [voiceId, previewing, previewUrl, workspacePath]);

  // The pacing/pronunciation rehearsal: render EXACTLY what the writer
  // highlighted -- markers become real silence, rules and [say] apply,
  // excluded spans skip. Local and free.
  const handlePreviewSelection = useCallback(async () => {
    if (!voiceId || previewing) return;
    const selected = getSelectionText?.() ?? "";
    if (!selected.trim()) {
      setError("Select a passage in the editor first.");
      return;
    }
    setPreviewing("selection");
    setError(null);
    try {
      const blob = await previewSelection(workspacePath, selected, voiceId);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection preview failed.");
    } finally {
      setPreviewing(null);
    }
  }, [voiceId, previewing, previewUrl, workspacePath, getSelectionText]);

  /** Icon logic shared by both preview buttons: the clicked one spins,
      the other shows a ban while it waits its turn. */
  const previewIcon = (own: "voice" | "selection") => {
    if (previewing === own) return <Loader2 size={12} className="animate-spin" />;
    if (previewing !== null) return <Ban size={12} className="text-zinc-600" />;
    return <Play size={12} />;
  };

  const [offerForce, setOfferForce] = useState(false);

  const handleStart = useCallback(async (force = false) => {
    if (!voiceId || busy) return;
    setBusy(true);
    setError(null);
    setOfferForce(false);
    try {
      await startGeneration(workspacePath, voiceId, force);
      await pollOnce();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start generation.";
      // "Everything is up to date" is not an error to a writer who wants a
      // fresh pass anyway -- surface the escape hatch instead of a wall.
      if (message.includes("up to date")) {
        setOfferForce(true);
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [voiceId, busy, workspacePath, pollOnce]);

  const control = useCallback(async (fn: (ws: string) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn(workspacePath);
      await pollOnce();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }, [workspacePath, pollOnce]);

  // ── Render ───────────────────────────────────────────────────────────────
  const total = run?.total_segments ?? 0;
  const done = (run?.completed_segments ?? 0) + (run?.failed_segments ?? 0);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const resumable = !active && run != null &&
    ["paused", "cancelled", "partially_completed"].includes(run.status);

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-800 p-4">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
        <Mic2 size={12} /> Narration
      </h3>

      {/* Engine / voice picker */}
      {engineState === "starting" && (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 size={13} className="animate-spin" />
          Starting the free local narrator...
        </p>
      )}
      {engineState === "unavailable" && (
        <p className="rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
          {engineError}
        </p>
      )}
      {engineState === "ready" && (
        <>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500" htmlFor="narrator-voice">
              Narrator voice ({voices.length} available, free and local)
            </label>
            <select
              id="narrator-voice"
              value={voiceId}
              onChange={e => setVoiceId(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
            >
              {voices.map(voice => (
                <option key={voice.id} value={voice.id}>{voice.label}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handlePreview()}
                disabled={previewing !== null || !voiceId}
                title={previewing === "selection" ? "Waiting for the selection preview to finish" : "Play a short sample sentence in this voice"}
                className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40"
              >
                {previewIcon("voice")}
                Preview voice
              </button>
              <button
                onClick={() => void handlePreviewSelection()}
                disabled={previewing !== null || !voiceId}
                title={previewing === "voice" ? "Waiting for the voice preview to finish" : "Highlight a passage in the editor, then hear exactly how it will sound -- pauses, pronunciations, and all. Local and free."}
                className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
              >
                {previewIcon("selection")}
                Preview selection
              </button>
            </div>
            <p className="mt-1 text-[9px] text-zinc-600">local &middot; free &middot; up to 3,000 characters</p>
            {previewUrl && (
              <audio controls autoPlay src={previewUrl} className="mt-2 w-full" />
            )}
          </div>

          {/* Start / resume -- the emerald path */}
          {!active && (
            <button
              onClick={() => void (resumable ? control(resumeGeneration) : handleStart())}
              disabled={busy || !voiceId}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {resumable ? "Resume Generation" : "Generate Audiobook"}
            </button>
          )}
          {/* The escape hatch when everything is "up to date" but the
              writer wants a fresh pass regardless. */}
          {!active && offerForce && (
            <button
              onClick={() => void handleStart(true)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-200 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
            >
              Regenerate Everything Anyway
            </button>
          )}
        </>
      )}

      {/* Live run -- the sapphire path */}
      {run && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className={
              run.status === "completed" ? "text-emerald-300"
              : run.status === "generating" ? "text-blue-300"
              : run.failed_segments > 0 ? "text-rose-300" : "text-zinc-400"
            }>
              {run.status === "generating" ? "Generating..." : run.status.replace(/_/g, " ")}
            </span>
            <span className="text-zinc-500">{done} / {total} segments</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full ${run.failed_segments > 0 ? "bg-rose-500" : run.status === "completed" ? "bg-emerald-500" : "bg-blue-500"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {run.failed_segments > 0 && (
            <p className="mt-1.5 text-[11px] text-rose-300">
              {run.failed_segments} segment{run.failed_segments === 1 ? "" : "s"} failed -- resume retries them.
            </p>
          )}
          {run.note && <p className="mt-1.5 text-[11px] text-blue-300">{run.note}</p>}

          {active && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void control(pauseGeneration)}
                disabled={busy}
                title="Finishes the current segment, then pauses"
                className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40"
              >
                <Pause size={11} /> Pause
              </button>
              <button
                onClick={() => void control(cancelGeneration)}
                disabled={busy}
                title="Finishes the current segment, then stops"
                className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-rose-600 hover:text-rose-300 disabled:opacity-40"
              >
                <Square size={11} /> Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <p className="mt-auto text-[10px] leading-relaxed text-zinc-600">
        Generation runs while Storythread is open and pauses if you close
        the app -- reopen and resume anytime. Draft free here; premium
        cloud voices arrive in a later update for the final print.
      </p>
    </aside>
  );
}
