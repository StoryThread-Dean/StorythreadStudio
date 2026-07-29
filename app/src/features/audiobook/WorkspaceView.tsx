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
  ArrowLeft, BookMarked, Loader2, MessageSquareQuote, Save, Scissors,
} from "lucide-react";

import { fetchNarration, saveNarration } from "./api";
import { GenerationPanel } from "./GenerationPanel";
import { PronunciationDialog } from "./PronunciationDialog";
import type { AudiobookChapter, AudiobookProjectPayload } from "./types";

interface WorkspaceViewProps {
  payload: AudiobookProjectPayload;
  onBack: () => void;
}

// The quick-action pause set (spec 10.1 defaults; configurability arrives
// with Settings in a later slice).
const PAUSE_ACTIONS: { label: string; snippet: string; title: string }[] = [
  { label: "Pause 0.4s", snippet: "[pause:0.4]", title: "Short pause" },
  { label: "Pause 0.8s", snippet: "[pause:0.8]", title: "Medium pause" },
  { label: "Pause 1.5s", snippet: "[pause:1.5]", title: "Long pause" },
  { label: "Scene Break", snippet: "[scene-break]", title: "Scene-break silence (2.0s default)" },
  { label: "Chapter Break", snippet: "[chapter-break]", title: "Timed silence only (3.0s default) -- chapters themselves come from # headings" },
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
      keep the writer's scroll position exactly where it was. */
  const insertAtCursor = useCallback((snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? start;
    setContent(content.slice(0, start) + snippet + content.slice(end));
    setDirty(true);
    pendingRestoreRef.current = { caret: start + snippet.length, scrollTop: ta.scrollTop };
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

  const handleSay = useCallback(() => {
    // [say:]word[/say] with the caret right after 'say:' -- the writer
    // types the spoken form in place. Works with or without a selection.
    wrapSelection("[say:]", "[/say]", "[say:".length);
  }, [wrapSelection]);

  const handleExclude = useCallback(() => {
    wrapSelection("[exclude]", "[/exclude]");
  }, [wrapSelection]);

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
        {PAUSE_ACTIONS.map(action => (
          <button
            key={action.snippet}
            onClick={() => insertAtCursor(`\n\n${action.snippet}\n\n`)}
            title={action.title}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300"
          >
            {action.label}
          </button>
        ))}
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
          <Scissors size={11} /> Exclude
        </button>
      </div>

      {/* Body: chapter rail + editor */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
            <BookMarked size={12} /> Chapters ({chapters.length})
          </h3>
          <ul className="space-y-0.5">
            {chapters.map(chapter => (
              <li key={chapter.chapter_id}>
                <button
                  onClick={() => jumpToChapter(chapter)}
                  className="w-full truncate rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  title={chapter.title}
                >
                  {chapter.order}. {chapter.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
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

        {/* Right rail: voice, preview, generate, run controls */}
        <GenerationPanel workspacePath={workspacePath} />
      </div>

      {showPronunciations && (
        <PronunciationDialog
          workspacePath={workspacePath}
          onClose={() => setShowPronunciations(false)}
        />
      )}
    </div>
  );
}
