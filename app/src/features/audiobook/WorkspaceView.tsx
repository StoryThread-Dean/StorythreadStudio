// features/audiobook/WorkspaceView.tsx
// =====================================
// The steady-state screen after import (spec 6.2): chapter list on the
// left, the narration editor in the middle, marker quick-actions on top.
// Stage A ships the Narration side; Chapters/Voice/Output tabs arrive with
// their stages.
//
// Editor philosophy: this is a focused narration-preparation editor, NOT a
// second writing app. It is a plain textarea over narration-copy.md --
// markers are typed text ([pause:0.8]), the toolbar just types them for
// you. Manual save only, exactly like the writing app: Ctrl+S or the Save
// button, with an unsaved indicator.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, BookMarked, EyeOff, HelpCircle, Loader2, MessageSquareQuote,
  Plus, Save, Scissors, Settings as SettingsIcon, Wand2, X,
} from "lucide-react";

import { addChapters, fetchAvailableChapters, fetchNarration, saveNarration } from "./api";
import type { AvailableChapter } from "./api";
import { InsertWalkthrough } from "./InsertWalkthrough";
import { GenerationPanel } from "./GenerationPanel";
import { MarkerHelpPanel } from "./MarkerHelpPanel";
import { paragraphBoundsAt, stripAudioMarkers } from "./markers";
import { AudiobookSettingsDialog } from "./AudiobookSettingsDialog";
import { PronunciationDialog } from "./PronunciationDialog";
import { SayEditor } from "./SayEditor";
import type { AudiobookChapter, AudiobookProjectPayload } from "./types";

interface WorkspaceViewProps {
  payload: AudiobookProjectPayload;
  onBack: () => void;
}

// The quick-action marker set (spec 10.1 defaults; configurability
// arrives with Settings in a later slice). Placement matters: a pause is
// PUNCTUATION and inserts inline right where the cursor sits -- wrapping
// it in blank lines would visually shred the writer's paragraph (an
// early-testing complaint; the parser reads markers inline just fine).
// Scene and chapter breaks are STRUCTURE and get their own line.
const PAUSE_ACTIONS: { label: string; snippet: string; title: string; inline: boolean }[] = [
  { label: "Pause 0.4s", snippet: "[pause:0.4]", title: "Short pause -- inserts right where your cursor is", inline: true },
  { label: "Pause 0.8s", snippet: "[pause:0.8]", title: "Medium pause -- inserts right where your cursor is", inline: true },
  { label: "Pause 1.5s", snippet: "[pause:1.5]", title: "Long pause -- inserts right where your cursor is", inline: true },
  { label: "Scene Break", snippet: "[scene-break]", title: "Scene-break silence (2.0s default) -- gets its own line", inline: false },
  { label: "Chapter Break", snippet: "[chapter-break]", title: "Timed silence only (3.0s default) -- chapters themselves come from # headings", inline: false },
];

export function WorkspaceView({ payload, onBack }: WorkspaceViewProps) {
  const workspacePath = payload.manifest.workspace_path;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chapters, setChapters] = useState<AudiobookChapter[]>(payload.chapters);
  const [warnings, setWarnings] = useState<string[]>(payload.warnings ?? []);
  const [error, setError] = useState<string | null>(null);
  const [showPronunciations, setShowPronunciations] = useState(false);
  const [showMarkerHelp, setShowMarkerHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped whenever audiobook settings are saved, so the narration rail
  // refetches what depends on them (the narration engine, above all).
  const [settingsVersion, setSettingsVersion] = useState(0);
  // The Insert Walkthrough starts at the caret when opened (null = closed).
  const [walkthroughStart, setWalkthroughStart] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setContent(await fetchNarration(workspacePath));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the narration text.");
      } finally {
        setLoading(false);
      }
    })();
  }, [workspacePath]);

  // ── Editing helpers ─────────────────────────────────────────────────────

  // Caret AND scroll restoration have to happen AFTER React re-renders
  // the textarea with the new value -- swapping a controlled textarea's
  // value resets its scroll position, which read as "the page jumps to
  // the bottom" every time a toolbar button was clicked. We remember both
  // the caret and scrollTop at click time and put them back post-commit.
  // focus({preventScroll}) keeps the focus call itself from scrolling.
  const pendingRestoreRef = useRef<{ caret: number; scrollTop: number } | null>(null);
  useEffect(() => {
    if (pendingRestoreRef.current === null) return;
    const { caret, scrollTop } = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    const ta = textareaRef.current;
    if (ta) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(caret, caret);
      ta.scrollTop = scrollTop;
    }
  }, [content]);

  /** Type `snippet` at the caret (replacing any selection), keep focus,
      keep the writer's scroll position exactly where it was.

      inline=true adds a space on either side only where one is missing,
      so "posture.[pause:0.4]Her" never happens -- but no blank lines are
      ever injected and the paragraph stays one paragraph. */
  const insertAtCursor = useCallback((snippet: string, inline = false) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? start;
    let insert = snippet;
    if (inline) {
      const before = content.slice(0, start);
      const after = content.slice(end);
      if (before && !/\s$/.test(before)) insert = " " + insert;
      if (after && !/^\s/.test(after)) insert = insert + " ";
    } else {
      insert = `\n\n${snippet}\n\n`;
    }
    setContent(content.slice(0, start) + insert + content.slice(end));
    setDirty(true);
    pendingRestoreRef.current = { caret: start + insert.length, scrollTop: ta.scrollTop };
  }, [content]);

  /** Wrap the current selection in before/after (Exclude, Say). */
  const wrapSelection = useCallback((before: string, after: string, caretIntoBefore?: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const selected = content.slice(start, end);
    setContent(content.slice(0, start) + before + selected + after + content.slice(end));
    setDirty(true);
    // caretIntoBefore places the caret INSIDE the opening marker (used by
    // [say:|] so the writer types the spoken form immediately).
    pendingRestoreRef.current = {
      caret: caretIntoBefore !== undefined
        ? start + caretIntoBefore
        : start + before.length + selected.length + after.length,
      scrollTop: ta.scrollTop,
    };
  }, [content]);

  // ── The [say] popout (user-designed) ────────────────────────────────────
  // Instead of typing into raw brackets, [say] opens a structured card
  // over the word: only the spoken form is typeable, with Preview and
  // occurrence hopping. See SayEditor.tsx.
  const [sayEditor, setSayEditor] = useState<{
    start: number; end: number;
    anchor: { top: number; left: number } | null;
  } | null>(null);

  /** Approximate pixel position of a text offset inside the textarea,
      via the classic hidden-mirror measurement. Best effort -- a null
      just docks the popout at the editor's top-left. */
  const measureAnchor = useCallback((index: number) => {
    const ta = textareaRef.current;
    if (!ta) return null;
    try {
      const style = window.getComputedStyle(ta);
      const mirror = document.createElement("div");
      mirror.style.position = "absolute";
      mirror.style.visibility = "hidden";
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.overflowWrap = "break-word";
      mirror.style.width = `${ta.clientWidth}px`;
      for (const prop of ["fontFamily", "fontSize", "fontWeight",
                          "lineHeight", "letterSpacing", "padding"] as const) {
        mirror.style[prop] = style[prop];
      }
      mirror.textContent = ta.value.slice(0, index);
      const marker = document.createElement("span");
      marker.textContent = ta.value.slice(index, index + 1) || ".";
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      // Just under the word's line, clamped into view.
      const top = ta.offsetTop + marker.offsetTop - ta.scrollTop + 26;
      const left = marker.offsetLeft - ta.scrollLeft;
      mirror.remove();
      return {
        top: Math.max(8, top),
        left: Math.max(8, Math.min(left, Math.max(8, ta.clientWidth - 440))),
      };
    } catch {
      return null;
    }
  }, []);

  const handleSay = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let start = ta.selectionStart ?? 0;
    let end = ta.selectionEnd ?? 0;
    const wordChar = /[A-Za-z0-9'’-]/;
    if (start === end) {
      // No selection: the word under the caret is the obvious target.
      while (start > 0 && wordChar.test(content[start - 1])) start -= 1;
      while (end < content.length && wordChar.test(content[end])) end += 1;
    }
    while (start < end && /\s/.test(content[start])) start += 1;
    while (end > start && /\s/.test(content[end - 1])) end -= 1;
    if (start === end) return;                 // nothing to pronounce
    setSayEditor({ start, end, anchor: measureAnchor(start) });
  }, [content, measureAnchor]);

  const handleExclude = useCallback(() => {
    wrapSelection("[exclude]", "[/exclude]");
  }, [wrapSelection]);

  /** [Remove]: strip audio markers from the selection -- or, with no
      selection, from the paragraph under the caret (the common case:
      caret sitting on a [pause:1.5] line the writer regrets). */
  const handleRemoveMarkers = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let start = ta.selectionStart ?? 0;
    let end = ta.selectionEnd ?? start;
    if (start === end) {
      ({ start, end } = paragraphBoundsAt(content, start));
    }
    const cleaned = stripAudioMarkers(content.slice(start, end));
    if (cleaned === content.slice(start, end)) return;   // nothing to do
    setContent(content.slice(0, start) + cleaned + content.slice(end));
    setDirty(true);
    pendingRestoreRef.current = { caret: start + cleaned.length, scrollTop: ta.scrollTop };
  }, [content]);

  /** Jump the caret to a chapter's heading line. */
  const jumpToChapter = useCallback((chapter: AudiobookChapter) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const idx = content.indexOf(`# ${chapter.title}`);
    if (idx < 0) return;
    ta.focus();
    ta.setSelectionRange(idx, idx);
    // Rough scroll: proportional to character position. Good enough for a
    // Stage A textarea; a smarter editor can land later if it earns it.
    ta.scrollTop = (idx / Math.max(content.length, 1)) * ta.scrollHeight;
  }, [content]);

  // ── Chapter add / remove ────────────────────────────────────────────────

  /** Cut a chapter (heading + body) out of the narration BUFFER -- a
      normal edit: dirty until Save, undone by leaving without saving.
      Located by heading text, nth occurrence for duplicate titles. */
  const removeChapter = useCallback((chapter: AudiobookChapter) => {
    if (!window.confirm(
      `Remove "${chapter.title}" from this audiobook?\n\n` +
      "Its narration text (including any markers you added) is cut from " +
      "the narration copy -- nothing is final until you Save. The " +
      "original book keeps the chapter.",
    )) return;
    const heading = `# ${chapter.title}`;
    const nth = chapters.filter(
      c => c.title === chapter.title && c.order < chapter.order).length;
    const lines = content.split("\n");
    const matches = lines
      .map((line, i) => (line.trim() === heading ? i : -1))
      .filter(i => i >= 0);
    if (nth >= matches.length) return;             // renamed in unsaved edits
    const start = matches[nth];
    const nextHeading = lines.findIndex(
      (line, i) => i > start && line.startsWith("# "));
    const end = nextHeading === -1 ? lines.length : nextHeading;
    setContent([...lines.slice(0, start), ...lines.slice(end)].join("\n"));
    setDirty(true);
  }, [chapters, content]);

  const [addChaptersState, setAddChaptersState] = useState<{
    open: boolean; loading: boolean; available: AvailableChapter[];
    picked: string[]; error: string | null;
  } | null>(null);

  const openAddChapters = useCallback(async () => {
    setAddChaptersState({ open: true, loading: true, available: [], picked: [], error: null });
    try {
      const result = await fetchAvailableChapters(workspacePath);
      setAddChaptersState({ open: true, loading: false,
                            available: result.available, picked: [], error: null });
    } catch (e) {
      setAddChaptersState({ open: true, loading: false, available: [], picked: [],
                            error: e instanceof Error ? e.message : "Could not read the source." });
    }
  }, [workspacePath]);

  const confirmAddChapters = useCallback(async () => {
    if (!addChaptersState || addChaptersState.picked.length === 0) return;
    try {
      const result = await addChapters(workspacePath, addChaptersState.picked);
      setContent(result.content);
      setChapters(result.chapters);
      setWarnings(result.warnings);
      setDirty(false);                 // the backend saved the narration copy
      setAddChaptersState(null);
    } catch (e) {
      setAddChaptersState(prev => prev && {
        ...prev, error: e instanceof Error ? e.message : "Adding chapters failed." });
    }
  }, [addChaptersState, workspacePath]);

  // ── Saving (manual only) ────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveNarration(workspacePath, content);
      setChapters(result.chapters);
      setWarnings(result.warnings);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [workspacePath, content, saving]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const handleBack = useCallback(() => {
    // Manual-save world: leaving with unsaved changes needs a real yes.
    if (dirty && !window.confirm("You have unsaved narration changes. Leave without saving?")) {
      return;
    }
    onBack();
  }, [dirty, onBack]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-300"
        >
          <ArrowLeft size={12} /> Dashboard
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
          {payload.manifest.title}
          {dirty && <span className="ml-2 text-emerald-400" title="Unsaved changes">●</span>}
        </p>
        <button
          onClick={() => setShowPronunciations(true)}
          className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-blue-600 hover:text-blue-300"
          title="Pronunciation dictionary for this audiobook and all audiobooks"
        >
          <MessageSquareQuote size={13} /> Pronunciations
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </button>
      </div>

      {/* Marker toolbar -- sapphire accents: informational tooling */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-800 px-4 py-2">
        {/* The walkthrough leads: it is the guided way to place
            everything the rest of this toolbar inserts by hand. */}
        <button
          onClick={() => {
            if (walkthroughStart !== null) { setWalkthroughStart(null); return; }
            setWalkthroughStart(textareaRef.current?.selectionStart ?? 0);
          }}
          title="Walk the manuscript from the cursor: pauses at dialogue hand-offs, beats between short sentences, marker repairs. Apply or skip each stop."
          className="inline-flex items-center gap-1 rounded border border-blue-800 bg-blue-950/50 px-2 py-1 text-[11px] text-blue-200 hover:border-blue-500 hover:text-blue-100"
        >
          <Wand2 size={11} /> Formatting Walkthrough
        </button>
        <span className="mx-1 h-4 w-px bg-zinc-800" />
        {PAUSE_ACTIONS.map(action => (
          <button
            key={action.snippet}
            onClick={() => insertAtCursor(action.snippet, action.inline)}
            title={action.title}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300"
          >
            {action.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-800" />
        {/* Pace spans: wrap the selection; Normal pace = unmarked text. */}
        {/* STEP form: each step is 0.05 off the book's base pace, so a
            span always lands on a speed the engine renders cleanly (the
            old multiplier form produced off-grid speeds like 1.08x, which
            slurred). +-2 = a 0.10 swing; hand-edit to +-1 or +-3 for finer
            or stronger moves. The backend caps results to 0.8-1.2. */}
        <button
          onClick={() => wrapSelection("[pace:-2]", "[/pace]")}
          title="Slow the selected passage two steps below your base pace -- let a heavy moment breathe"
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300"
        >
          Slow
        </button>
        <button
          onClick={() => wrapSelection("[pace:+2]", "[/pace]")}
          title="Quicken the selected passage two steps above your base pace -- carry an action beat"
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300"
        >
          Fast
        </button>
        <span className="mx-1 h-4 w-px bg-zinc-800" />
        <button
          onClick={handleSay}
          title="One-spot pronunciation: select a word, then type how it should be spoken"
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300"
        >
          [say]
        </button>
        <button
          onClick={handleExclude}
          title="Keep the selected text in the file but never narrate it"
          className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300"
        >
          <EyeOff size={11} /> Exclude
        </button>
        <span className="mx-1 h-4 w-px bg-zinc-800" />
        <button
          onClick={handleRemoveMarkers}
          title="Remove audio markers from the selection (or the paragraph under the cursor). Your words stay."
          className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-rose-600 hover:text-rose-300"
        >
          <Scissors size={11} /> Remove
        </button>
        <button
          onClick={() => setShowMarkerHelp(v => !v)}
          title="What do these buttons do? Includes audio examples."
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-500 hover:text-blue-300"
        >
          <HelpCircle size={11} /> {showMarkerHelp ? "Hide help" : "What's this?"}
        </button>
      </div>

      {showMarkerHelp && <MarkerHelpPanel />}

      {walkthroughStart !== null && (
        <InsertWalkthrough
          content={content}
          startOffset={walkthroughStart}
          onApplyEdit={(next, caret) => {
            const ta = textareaRef.current;
            pendingRestoreRef.current = {
              caret, scrollTop: ta?.scrollTop ?? 0 };
            setContent(next);
            setDirty(true);
          }}
          onHighlight={(offset, length) => {
            const ta = textareaRef.current;
            if (!ta) return;
            ta.focus({ preventScroll: true });
            ta.setSelectionRange(offset, offset + Math.max(length, 1));
            ta.scrollTop = (offset / Math.max(content.length, 1)) * ta.scrollHeight
              - ta.clientHeight / 3;
          }}
          onClose={() => setWalkthroughStart(null)}
        />
      )}

      {/* Body: chapter rail + editor */}
      <div className="flex min-h-0 flex-1">
        {/* Left rail: chapters scroll, the settings gear stays pinned at
            the bottom (so it is always one click away, and never floats
            in the middle of a long chapter list). */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
            <BookMarked size={12} /> Chapters ({chapters.length})
          </h3>
          <ul className="space-y-0.5">
            {chapters.map(chapter => (
              <li key={chapter.chapter_id} className="group flex items-center">
                <button
                  onClick={() => jumpToChapter(chapter)}
                  className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  title={chapter.title}
                >
                  {chapter.order}. {chapter.title}
                </button>
                <button
                  onClick={() => removeChapter(chapter)}
                  title={`Remove "${chapter.title}" from this audiobook (the original book is untouched)`}
                  aria-label={`Remove chapter ${chapter.title}`}
                  className="invisible shrink-0 rounded px-1 py-1 text-zinc-600 hover:text-rose-400 group-hover:visible"
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => void openAddChapters()}
            disabled={dirty}
            title={dirty
              ? "Save your narration changes first, then add chapters."
              : "Pull in chapters the source book gained since this audiobook was made"}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded border border-dashed border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-400 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
          >
            <Plus size={11} /> Add chapters
          </button>
        </div>
          <div className="shrink-0 border-t border-zinc-800 p-2">
            <button
              onClick={() => setSettingsOpen(true)}
              title="Narration engine, API keys, and this book's pacing"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-blue-600 hover:text-blue-300"
            >
              <SettingsIcon size={12} /> Audiobook Settings
            </button>
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col">
          {sayEditor && (
            <SayEditor
              content={content}
              start={sayEditor.start}
              end={sayEditor.end}
              workspacePath={workspacePath}
              voiceId={payload.manifest.selected_voice ?? "am_michael"}
              anchor={sayEditor.anchor}
              onApply={next => { setContent(next); setDirty(true); }}
              onLocate={pos => {
                const ta = textareaRef.current;
                if (!ta) return;
                ta.scrollTop = (pos / Math.max(content.length, 1)) * ta.scrollHeight
                  - ta.clientHeight / 3;
                setSayEditor(prev => prev && { ...prev, anchor: measureAnchor(pos) });
              }}
              onClose={() => setSayEditor(null)}
            />
          )}
          {warnings.length > 0 && (
            <div className="shrink-0 border-b border-zinc-800 bg-blue-950/40 px-4 py-2">
              {warnings.map((warning, i) => (
                <p key={i} className="text-[11px] text-blue-300">{warning}</p>
              ))}
            </div>
          )}
          {error && (
            <p className="shrink-0 border-b border-zinc-800 bg-rose-950/60 px-4 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
          {loading ? (
            <p className="p-6 text-sm text-zinc-500">Loading narration...</p>
          ) : (
            <textarea
              ref={textareaRef}
              aria-label="Narration text"
              value={content}
              onChange={e => { setContent(e.target.value); setDirty(true); }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-zinc-950 p-5 font-mono text-sm leading-relaxed text-zinc-200 outline-none"
            />
          )}
        </div>

        {/* Right rail: voice, preview, generate, run controls. The
            selection getter reads live from the textarea so Preview
            Selection always rehearses exactly what is highlighted. */}
        <GenerationPanel
          workspacePath={workspacePath}
          initialVoiceId={payload.manifest.selected_voice}
          settingsVersion={settingsVersion}
          onOpenSettings={() => setSettingsOpen(true)}
          getSelectionText={() => {
            const ta = textareaRef.current;
            if (!ta) return "";
            return content.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
          }}
        />
      </div>

      {showPronunciations && (
        <PronunciationDialog
          workspacePath={workspacePath}
          onClose={() => setShowPronunciations(false)}
        />
      )}

      {settingsOpen && (
        <AudiobookSettingsDialog
          workspacePath={workspacePath}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsVersion(v => v + 1)}
        />
      )}

      {addChaptersState?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-96 max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <h3 className="mb-2 text-sm font-semibold text-zinc-100">Add chapters</h3>
            {addChaptersState.loading ? (
              <p className="text-xs text-zinc-400">
                <Loader2 size={12} className="mr-1 inline animate-spin" />
                Reading the original source...
              </p>
            ) : addChaptersState.available.length === 0 && !addChaptersState.error ? (
              <p className="text-xs text-zinc-400">
                The source has no chapters this audiobook is missing. (A
                renamed chapter counts as missing on the source side --
                rename it back here if you meant to match it.)
              </p>
            ) : (
              <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto">
                {addChaptersState.available.map(chapter => (
                  <li key={chapter.title}>
                    <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={addChaptersState.picked.includes(chapter.title)}
                        onChange={e => setAddChaptersState(prev => prev && {
                          ...prev,
                          picked: e.target.checked
                            ? [...prev.picked, chapter.title]
                            : prev.picked.filter(t => t !== chapter.title),
                        })}
                      />
                      <span>
                        {chapter.title}
                        <span className="ml-1 text-[10px] text-zinc-500">
                          ({(chapter.characters / 1000).toFixed(1)}k characters)
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {addChaptersState.error && (
              <p className="mb-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[10px] text-rose-300">
                {addChaptersState.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAddChaptersState(null)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
              >
                Close
              </button>
              <button
                onClick={() => void confirmAddChapters()}
                disabled={addChaptersState.picked.length === 0}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Add {addChaptersState.picked.length || ""} selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
