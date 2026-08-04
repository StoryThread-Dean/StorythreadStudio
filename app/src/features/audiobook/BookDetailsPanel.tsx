// features/audiobook/BookDetailsPanel.tsx
// ========================================
// The metadata form (spec 17): what the exported files SAY about
// themselves -- ID3 tags on the MP3s, the M4B's metadata atom, and the
// embedded cover art. Collapsible block in the Narration rail, above
// Export. Manual save (house rule): edits mark the form dirty; nothing
// persists until [Save Details].

import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";

import {
  coverImageUrl, fetchMetadata, removeCover, saveMetadata, setCover,
} from "./api";
import type { BookMetadata } from "./api";

// Field layout: [key, label, wide?]. Wide fields take the full row.
const TEXT_FIELDS: Array<[keyof BookMetadata, string, boolean]> = [
  ["title", "Title", true],
  ["subtitle", "Subtitle", true],
  ["author", "Author", false],
  ["narrator", "Narrator", false],
  ["series", "Series", false],
  ["series_number", "Series #", false],
  ["genre", "Genre", false],
  ["publication_year", "Year", false],
  ["publisher", "Publisher", false],
  ["language", "Language", false],
  ["copyright", "Copyright", true],
  ["description", "Description", true],
];

const OPTIONS: Array<[keyof BookMetadata, string, string]> = [
  ["use_chapter_names", "Use chapter names as chapter markers",
   "Off = markers read 'Chapter 1', 'Chapter 2'... while filenames keep the real titles"],
  ["embed_cover", "Embed cover image",
   "The cover rides inside the MP3s and the M4B, like store-bought audiobooks"],
  ["apply_to_chapter_mp3s", "Apply metadata to chapter MP3 files",
   "Off = per-chapter files carry only title, track, album, and author"],
];

interface BookDetailsPanelProps {
  workspacePath: string;
  /** The narrator-voice label currently picked in the Voice section, so
      [Use current voice] fills the Narrator field without retyping. */
  currentVoiceLabel?: string | null;
}

export function BookDetailsPanel({ workspacePath, currentVoiceLabel }: BookDetailsPanelProps) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<BookMetadata | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverHint, setCoverHint] = useState<string | null>(null);
  const [coverBust, setCoverBust] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchMetadata(workspacePath);
        if (!cancelled) setMeta(loaded);
      } catch { /* backend banner covers it */ }
    })();
    return () => { cancelled = true; };
  }, [workspacePath]);

  const edit = useCallback((key: keyof BookMetadata, value: string | boolean) => {
    setMeta(prev => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!meta || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { cover_file: _cover, ...fields } = meta;
      setMeta(await saveMetadata(workspacePath, fields));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saving book details failed.");
    } finally {
      setSaving(false);
    }
  }, [meta, saving, workspacePath]);

  const pickCover = useCallback(async () => {
    setError(null);
    setCoverHint(null);
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const picked = await dialog.open({
        multiple: false,
        filters: [{ name: "Cover image (JPG or PNG)", extensions: ["jpg", "jpeg", "png"] }],
      });
      if (typeof picked !== "string") return;
      setCoverBusy(true);
      const info = await setCover(workspacePath, picked);
      setMeta(prev => (prev ? { ...prev, cover_file: info.cover_file } : prev));
      setCoverBust(v => v + 1);
      if (info.width && info.height && !info.square) {
        setCoverHint(
          `${info.width}x${info.height} -- audiobook stores expect a SQUARE ` +
          "cover (1400x1400 to 3000x3000). It will still embed as-is.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setting the cover failed.");
    } finally {
      setCoverBusy(false);
    }
  }, [workspacePath]);

  const handleRemoveCover = useCallback(async () => {
    setError(null);
    try {
      await removeCover(workspacePath);
      setMeta(prev => (prev ? { ...prev, cover_file: null } : prev));
      setCoverHint(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Removing the cover failed.");
    }
  }, [workspacePath]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <BookOpen size={12} /> Book Details
        {dirty && (
          <span className="ml-auto rounded bg-amber-900/60 px-1.5 py-0.5 text-[9px] font-normal normal-case tracking-normal text-amber-300"
                title="Edited but not saved">
            unsaved
          </span>
        )}
      </button>

      {open && meta && (
        <div className="mt-3">
          <p className="mb-2 text-[10px] text-zinc-500">
            What the exported files say about themselves: tags, chapter
            markers, and the cover shown in audiobook players.
          </p>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {TEXT_FIELDS.map(([key, label, wide]) => (
              <div key={key} className={wide ? "col-span-2" : ""}>
                <span className="mb-0.5 flex items-center justify-between text-[10px] text-zinc-400">
                  <label htmlFor={`book-detail-${key}`}>{label}</label>
                  {key === "narrator" && currentVoiceLabel && (
                    <button
                      type="button"
                      onClick={() => {
                        // The voice label is "Michael (American male)" --
                        // the tag wants the name, not the parenthetical.
                        edit("narrator", currentVoiceLabel.replace(/\s*\(.*\)$/, ""));
                      }}
                      className="cursor-pointer text-[10px] text-blue-400 hover:text-blue-300 hover:underline"
                      title={`Fill with the selected voice: ${currentVoiceLabel}`}
                    >
                      Use current voice
                    </button>
                  )}
                </span>
                {key === "description" ? (
                  <textarea
                    id={`book-detail-${key}`}
                    value={meta[key] as string}
                    onChange={e => edit(key, e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-600 focus:outline-none"
                  />
                ) : (
                  <input
                    id={`book-detail-${key}`}
                    type="text"
                    value={meta[key] as string}
                    onChange={e => edit(key, e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-600 focus:outline-none"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Cover art */}
          <div className="mb-3">
            <span className="mb-1 block text-[10px] text-zinc-400">Cover image</span>
            <div className="flex items-start gap-3">
              {meta.cover_file ? (
                <img
                  src={coverImageUrl(workspacePath, coverBust)}
                  alt="Cover preview"
                  className="h-20 w-20 rounded border border-zinc-700 object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded border border-dashed border-zinc-700 text-zinc-600">
                  <ImagePlus size={18} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => void pickCover()}
                  disabled={coverBusy}
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40"
                >
                  {coverBusy ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}
                  {meta.cover_file ? "Replace Cover" : "Choose Cover"}
                </button>
                {meta.cover_file && (
                  <button
                    onClick={() => void handleRemoveCover()}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-rose-600 hover:text-rose-300"
                  >
                    <X size={11} /> Remove
                  </button>
                )}
                <span className="text-[9px] text-zinc-500">JPG or PNG, square recommended</span>
              </div>
            </div>
            {coverHint && (
              <p className="mt-1.5 rounded border border-amber-800 bg-amber-950/50 px-2 py-1 text-[10px] text-amber-300">
                {coverHint}
              </p>
            )}
          </div>

          {/* Options */}
          <div className="mb-3 space-y-1">
            {OPTIONS.map(([key, label, hint]) => (
              <label key={key} className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-300"
                     title={hint}>
                <input
                  type="checkbox"
                  checked={meta[key] as boolean}
                  onChange={e => edit(key, e.target.checked)}
                  className="mt-0.5"
                />
                {label}
              </label>
            ))}
          </div>

          <button
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save Details
          </button>

          {error && (
            <p className="mt-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[10px] text-rose-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
