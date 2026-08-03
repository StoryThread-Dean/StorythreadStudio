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
  cancelGeneration, fetchEngineStatus, fetchGenerationStatus,
  fetchVoices, installEngine, pauseGeneration,
  previewSelection, previewVoice, resetGeneration, resumeGeneration,
  saveVoice, startGeneration,
} from "./api";
import type { AudioStatus, EngineStatus, PreviewTracePiece } from "./api";
import { BookDetailsPanel } from "./BookDetailsPanel";
import { ExportPanel } from "./ExportPanel";
import { PremiumNarrationPanel } from "./PremiumNarrationPanel";
import { ToggleSwitch } from "./ToggleSwitch";
import { WhatsThis } from "./WhatsThis";
import type { GenerationRun, NarratorVoice } from "./types";

interface GenerationPanelProps {
  workspacePath: string;
  /** Current editor selection (raw narration text incl. markers), "" when
      nothing is selected. Provided by WorkspaceView so the Preview
      Selection button can rehearse exactly what the writer highlighted. */
  getSelectionText?: () => string;
  /** The voice remembered for THIS book (manifest.selected_voice) --
      restored when the workspace opens; different books use different
      voices on purpose. The Cast panel writes the same field, so a
      change there arrives here as a new value and is adopted. */
  initialVoiceId?: string | null;
  /** The writer picked a voice HERE, so whoever owns the narrator's
      voice elsewhere (the Cast panel) can stay in step. */
  onVoiceChange?: (voiceId: string) => void;
  /** Bumped by WorkspaceView whenever Audiobook Settings are saved, so
      the rail refetches what depends on them (the narration engine). */
  settingsVersion?: number;
  /** A run reached a terminal state, so anything derived from the audio
      (the chapter freshness badges, above all) is now stale. */
  onRunFinished?: () => void;
  /** Open the Audiobook Settings dialog -- the premium panel points at
      it, since the engine is chosen there and nowhere else. */
  onOpenSettings?: () => void;
  /** Chapter freshness, owned by WorkspaceView (it refreshes on save).
      Used only to SAY that sections are outdated -- the Generate button
      already re-does exactly those, so there is no second action. */
  audioStatus?: AudioStatus | null;
}

// The out-of-the-box narrator when a book has no remembered voice yet.
const DEFAULT_VOICE_ID = "am_michael";

// A run that reports one of these has genuinely stopped. Anything else
// -- including a status that could not be read at all -- means keep
// looking.
const TERMINAL_STATUSES = [
  "completed", "partially_completed", "cancelled", "paused",
];

const PREVIEW_SAMPLE =
  "The road disappeared beneath the gathering snow, and somewhere behind " +
  "her, a second set of footsteps stopped.";

/** The component-manager block shown when no usable engine exists --
    either none is installed, or the installed one is from a different
    release and must be updated (the backend refuses to spawn a worker it
    cannot talk to). One button, live progress, and a retry path into the
    voices flow once the engine lands. */
function InstallEngineBlock({ message, onInstalled }: { message: string; onInstalled: () => void }) {
  const isUpdate = message.includes("needs an update");
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void (async () => {
      try { setStatus(await fetchEngineStatus()); } catch { /* banner covers it */ }
    })();
  }, []);

  // Poll while an install runs; hand off when it completes.
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await fetchEngineStatus();
        setStatus(fresh);
        if (fresh.install.state === "done") {
          window.clearInterval(timer);
          setInstalling(false);
          onInstalled();
        } else if (fresh.install.state === "error") {
          window.clearInterval(timer);
          setInstalling(false);
          setError(fresh.install.error ?? "Install failed.");
        }
      } catch { /* keep polling; banner covers a dead backend */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [installing, onInstalled]);

  const handleInstall = useCallback(async () => {
    setError(null);
    try {
      await installEngine();
      setInstalling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed to start.");
    }
  }, []);

  const install = status?.install;
  const busy = installing && install && ["starting", "downloading", "verifying", "extracting"].includes(install.state);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <p className="mb-2 text-xs text-zinc-300">{message}</p>
      {busy ? (
        <>
          <p className="mb-1 text-[11px] text-blue-300">
            {install.state === "downloading"
              ? `Downloading... ${Math.round(install.progress * 100)}%`
              : install.state === "verifying" ? "Verifying download..."
              : "Installing..."}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-blue-500"
                 style={{ width: `${Math.round((install.progress ?? 0) * 100)}%` }} />
          </div>
        </>
      ) : (
        <button
          onClick={() => void handleInstall()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          {isUpdate ? "Update Free Local Narrator" : "Install Free Local Narrator"}
          {status?.download_size_mb && (
            <span className="font-normal opacity-75">(~{Math.round(status.download_size_mb)} MB)</span>
          )}
        </button>
      )}
      <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">
        One download, all {""}voices included. Runs entirely on your
        computer -- narration is free forever.
      </p>
      {error && (
        <p className="mt-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[10px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function GenerationPanel({
  workspacePath, getSelectionText, initialVoiceId,
  settingsVersion = 0, onOpenSettings, audioStatus, onVoiceChange,
  onRunFinished,
}: GenerationPanelProps) {
  const [voices, setVoices] = useState<NarratorVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [engineState, setEngineState] = useState<"starting" | "ready" | "unavailable">("starting");
  const [engineError, setEngineError] = useState<string | null>(null);

  // Which preview is rendering right now. One at a time; the button that
  // was clicked spins, the OTHER shows a ban icon -- two spinners made it
  // look like both were running (live-testing feedback).
  const [previewing, setPreviewing] = useState<null | "voice" | "selection">(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewTrace, setPreviewTrace] = useState<PreviewTracePiece[]>([]);

  const [run, setRun] = useState<GenerationRun | null>(null);
  const [active, setActive] = useState(false);
  // Keep watching after a run is known to exist, until a TERMINAL status
  // is actually seen. One falsey reading used to end the polling loop
  // for good -- and a status read that lands inside a file write is a
  // falsey reading, which over a 200-segment run is a certainty. The
  // writer was left with an idle Generate button over a live job.
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);          // a control call in flight
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  // ── Engine + voices (first call spawns the worker; can take a bit) ──────
  const loadVoices = useCallback(async () => {
    setEngineState("starting");
    try {
      const list = await fetchVoices();
      setVoices(list);
      // Restore this book's remembered voice; new books start on the
      // default narrator (Michael); either way never an empty pick.
      setVoiceId(prev => {
        if (prev) return prev;
        const remembered = initialVoiceId && list.some(v => v.id === initialVoiceId)
          ? initialVoiceId : "";
        const fallback = list.some(v => v.id === DEFAULT_VOICE_ID)
          ? DEFAULT_VOICE_ID : (list[0]?.id ?? "");
        return remembered || fallback;
      });
      setEngineState("ready");
    } catch (e) {
      setEngineState("unavailable");
      setEngineError(e instanceof Error ? e.message : "Local narrator unavailable.");
    }
  }, [initialVoiceId]);

  useEffect(() => { void loadVoices(); }, [loadVoices]);

  // The narrator's voice lives in ONE place -- the book's manifest --
  // and two screens edit it: this rail and the Cast panel. Whichever
  // wrote last wins, and this is how the other one finds out. Without
  // it the rail kept showing Lily while the cast said Alice, and the
  // writer had no way to tell which one the audio would use.
  useEffect(() => {
    if (initialVoiceId && initialVoiceId !== voiceId) setVoiceId(initialVoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVoiceId]);

  // ── Status polling ───────────────────────────────────────────────────────
  const pollOnce = useCallback(async () => {
    try {
      const body = await fetchGenerationStatus(workspacePath);
      setRun(body.run);
      setActive(body.active);
      if (body.active) {
        setWatching(true);
      } else if (body.run && TERMINAL_STATUSES.includes(body.run.status)) {
        // The run really is over: it said so itself. Everything derived
        // from the audio is stale the moment it stops -- the freshness
        // notice above the button was still claiming "16 sections no
        // longer match" after the run that fixed them (live finding).
        setWatching(prev => { if (prev) onRunFinished?.(); return false; });
      }
      // Not active and no readable run? Say nothing and keep watching.
      // "I could not read it" is not "it finished".
      return body.active;
    } catch {
      return false;      // backend hiccup -- the banner system covers it
    }
  }, [workspacePath]);

  useEffect(() => {
    void pollOnce();     // pick up an existing/interrupted run on mount
  }, [pollOnce]);

  useEffect(() => {
    if (!active && !watching) {
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
  }, [active, watching, pollOnce]);

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
    setPreviewWarnings([]);
    setPreviewTrace([]);
    try {
      const { blob, warnings, trace } = await previewSelection(workspacePath, selected, voiceId);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewWarnings(warnings);
      setPreviewTrace(trace);
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
  // Draft pass: the fast testing gear. Session-only; Standard is always
  // the default so a fresh session can never accidentally draft.
  const [draftPass, setDraftPass] = useState(false);

  const handleStart = useCallback(async (force = false) => {
    if (!voiceId || busy) return;
    setBusy(true);
    setError(null);
    setOfferForce(false);
    try {
      await startGeneration(workspacePath, voiceId, force, draftPass);
      setWatching(true);
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
  }, [voiceId, busy, workspacePath, pollOnce, draftPass]);

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
        (engineError?.includes("not installed") || engineError?.includes("needs an update")) ? (
          // The engine isn't here (or is an incompatible older release) --
          // offer the install/update, not an error wall. Success flows
          // straight back into voice loading.
          <InstallEngineBlock
            message={engineError}
            onInstalled={() => void loadVoices()}
          />
        ) : (
          <p className="rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
            {engineError}
          </p>
        )
      )}
      {engineState === "ready" && (
        <>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500" htmlFor="narrator-voice">
              Narrator voice ({voices.length} available, free and local)
            </label>
            {/* Voice and its sample share one line: the dropdown sizes to
                its widest option instead of stretching the rail. */}
            <div className="flex items-center gap-2">
              <select
                id="narrator-voice"
                value={voiceId}
                onChange={e => {
                  setVoiceId(e.target.value);
                  onVoiceChange?.(e.target.value);
                  // Fire-and-forget: the book remembers its narrator.
                  void saveVoice(workspacePath, e.target.value).catch(() => {});
                }}
                className="w-auto min-w-0 max-w-[11rem] flex-1 truncate rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              >
                {voices.map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
              <button
                onClick={() => void handlePreview()}
                disabled={previewing !== null || !voiceId}
                title={previewing === "selection" ? "Waiting for the selection sample to finish" : "Play a short sample sentence in this voice"}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-200 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40"
              >
                {previewIcon("voice")}
                Sample
              </button>
            </div>
            <div className="mt-1">
              <WhatsThis label="Which voices work with premium?">
                Every voice here is also available on the Budget hosted
                Kokoro tier -- it is the same engine, so the voice you
                draft with carries straight through to the paid narration.
                The Standard and Pro engines are different models with
                their own casts, so a voice from this list cannot follow
                you there; you would pick from theirs instead. Worth
                knowing before you fall for one particular narrator.
              </WhatsThis>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handlePreviewSelection()}
                disabled={previewing !== null || !voiceId}
                title={previewing === "voice" ? "Waiting for the voice sample to finish" : "Highlight a passage in the editor, then hear exactly how it will sound -- pauses, pronunciations, and all. Local and free."}
                className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
              >
                {previewIcon("selection")}
                Sample selection
              </button>
            </div>
            <p className="mt-1 text-[9px] text-zinc-600">local &middot; free &middot; up to 3,000 characters</p>
            {previewUrl && (
              <audio controls autoPlay src={previewUrl} className="mt-2 w-full" />
            )}
            {previewWarnings.map((warning, i) => (
              <p key={i} className="mt-1.5 rounded border border-blue-800 bg-blue-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-blue-300">
                {warning}
              </p>
            ))}
            {/* The render trace: ground truth of what each piece used.
                "Did my pace apply?" is answered here, not by ear. */}
            {previewTrace.length > 0 && (
              <div className="mt-1.5 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                {previewTrace.map((piece, i) => (
                  <p key={i} className="truncate text-[10px] leading-relaxed text-zinc-500">
                    <span className={piece.marker_pace ? "text-blue-300" : "text-zinc-400"}>
                      {piece.speed.toFixed(2)}x
                    </span>
                    {piece.dialogue && <span className="text-emerald-400"> dialogue</span>}
                    {piece.marker_pace != null && <span className="text-blue-300"> [pace:{piece.marker_pace}]</span>}
                    {" "}&ldquo;{piece.snippet}...&rdquo;
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Narration Settings (pacing and break lengths) now live in
              Audiobook Settings, behind the gear at the bottom of the
              chapter rail -- four numeric fields were crowding the work
              out of a 288px rail. */}

          {/* Draft toggle: the fast testing gear. Flow synthesis is
              skipped (pauses kept, pre-flow sound) -- about twice as
              fast on pause-heavy chapters. Draft audio is stale to a
              Standard run, so it can never ship by accident. */}
          {watching && !active && !resumable && (
            <p className="flex items-center gap-2 text-[11px] text-blue-300">
              <Loader2 size={12} className="animate-spin" />
              Checking on the run...
            </p>
          )}
          {!active && !resumable && !watching && (
            <div>
              <ToggleSwitch
                checked={draftPass}
                onChange={setDraftPass}
                tone="amber"
                label="Draft/Testing pass"
                hint={draftPass
                  ? "About twice as fast, with seam artifacts at pauses."
                  : "Off: full quality. Turn on to test pacing quickly."}
              />
              <div className="mt-1">
                <WhatsThis label="What's the difference?">
                  <span className="block">
                    <strong className="text-zinc-200">Off (full quality):</strong>{" "}
                    a paragraph with mid-sentence pauses is rendered as ONE
                    continuous read, then your pauses are placed into its
                    natural sentence gaps. No seams, but the engine does
                    roughly twice the work on those paragraphs.
                  </span>
                  <span className="mt-1.5 block">
                    <strong className="text-amber-200">On (draft):</strong>{" "}
                    each fragment is rendered on its own and the pauses sit
                    at the cuts. About half the time, at the cost of the
                    slur and cold-start artifacts you hear at pause edges.
                    Good for checking pacing, beats, and pronunciations.
                  </span>
                  <span className="mt-1.5 block">
                    Draft audio counts as out of date, so a full-quality run
                    re-does every draft segment automatically. Nothing you
                    export can be accidentally draft-quality.
                  </span>
                </WhatsThis>
              </div>
            </div>
          )}

          {/* Spec 24.3: audio that no longer matches the narration, said
              out loud with the count. Never a prompt to spend -- the
              Generate button below already re-does exactly the changed
              segments, so this is information, not a second path. */}
          {/* Where the seam slurs are. A pause group whose continuous
              render could not be matched falls back to isolated
              fragments, and an isolated fragment is exactly what flow
              synthesis exists to avoid -- the engine performs an ending
              on it. Reporting the count turns "I can hear a slur
              somewhere" into paragraphs to look at. */}
          {!active && !watching && audioStatus
            && audioStatus.flow_fallbacks > 0 && (
            <p className="rounded border border-zinc-700 bg-zinc-900/60 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-400">
              <span className="text-zinc-300">
                {audioStatus.flow_fallbacks} pause group
                {audioStatus.flow_fallbacks === 1 ? "" : "s"} rendered as
                separate pieces.
              </span>{" "}
              Those are the places a seam can be heard. It happens when
              several pauses sit close together and the continuous render
              cannot be lined up against them. Moving one pause to a
              sentence boundary, or removing it, usually clears it.
            </p>
          )}

          {!active && !watching && audioStatus && audioStatus.outdated_segments > 0 && (
            <div className="rounded border border-amber-800 bg-amber-950/30 px-2.5 py-2">
              <p className="text-[11px] leading-relaxed text-amber-200">
                {audioStatus.outdated_segments === 1
                  ? "1 section no longer matches its audio"
                  : `${audioStatus.outdated_segments} sections no longer match their audio`}
                {audioStatus.outdated_reason === "voice"
                  ? " -- the voice changed." : "."}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-amber-200/70">
                {audioStatus.outdated_reason === "voice"
                  ? "Generating re-narrates the book in the new voice. Keeping "
                    + "the existing audio is fine too -- nothing is regenerated "
                    + "until you say so."
                  : "Generating re-does exactly those sections and leaves the "
                    + "rest alone. Nothing is regenerated until you say so."}
              </p>
            </div>
          )}

          {/* Start / resume -- the emerald path */}
          {!active && !watching && (
            <button
              onClick={() => void (resumable ? control(resumeGeneration) : handleStart())}
              disabled={busy || !voiceId}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {resumable ? "Resume Generation"
                : draftPass ? "Generate Draft (fast)" : "Generate Audiobook"}
            </button>
          )}
          {/* The escape hatch under Resume: forget the interrupted run
              (and any stale lock a crash or reboot left behind) so the
              writer can start over without being blocked. */}
          {resumable && (
            <button
              onClick={() => {
                if (!window.confirm(
                  "Cancel this generation run and start over?\n\n" +
                  "Finished segments keep their audio and will not be " +
                  "redone. The interrupted run (and any stuck workspace " +
                  "lock) is cleared so Generate is available fresh.")) return;
                void (async () => {
                  setError(null);
                  try {
                    await resetGeneration(workspacePath);
                    await pollOnce();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Reset failed.");
                  }
                })();
              }}
              className="self-center text-[10px] text-rose-400 hover:text-rose-300 hover:underline"
            >
              Cancel generation and start over
            </button>
          )}
          {/* A finished draft must say so where the writer will see it. */}
          {run?.draft && (
            <p className="rounded border border-amber-800 bg-amber-950/50 px-2 py-1.5 text-[11px] text-amber-300">
              Draft-quality audio{active ? " is generating" : ""}. Regenerate
              in Standard quality before exporting -- a Standard run
              re-queues all draft segments automatically.
            </p>
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

      {/* The print pass: everything that can SPEND money, in violet, in
          one place, behind an estimate and a confirm (spec 13/19). */}
      <PremiumNarrationPanel
        workspacePath={workspacePath}
        localVoices={voices}
        settingsVersion={settingsVersion}
        onOpenSettings={onOpenSettings}
        getSelectionText={getSelectionText}
        onRunStarted={() => { void pollOnce(); }}
      />

      {/* Book Details: tags + cover for the exported files (spec 17). */}
      <BookDetailsPanel
        workspacePath={workspacePath}
        currentVoiceLabel={voices.find(v => v.id === voiceId)?.label ?? null}
      />

      {/* Export: only meaningful once a run has completed at least once,
          but harmless earlier -- the backend refuses honestly. */}
      <ExportPanel workspacePath={workspacePath} />

      <p className="mt-auto text-[10px] leading-relaxed text-zinc-600">
        Generation runs while Storythread is open and pauses if you close
        the app -- reopen and resume anytime. Draft free here; premium
        cloud voices arrive in a later update for the final print.
      </p>
    </aside>
  );
}
