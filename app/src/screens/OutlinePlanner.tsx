// OutlinePlanner.tsx -- Structured outline editor
// ================================================
// A full-width view that renders notes/outline.md as:
//   1. A "Project Targets" form for the YAML frontmatter fields
//      (word target, expected characters/locations/lore/relationships)
//   2. Collapsible section cards for each ## heading in the outline body
//      with inline textarea editing
//
// The writer never sees raw YAML. Changes are saved via POST /api/documents/outline
// which reconstructs and writes the file server-side.
//
// Data flow:
//   mount     -> GET /api/documents/outline -> populate form + sections
//   edit      -> local state; dirty flag set
//   Ctrl+S / Save button -> POST /api/documents/outline
//   onBack    -> returns to editor view

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import type { ProjectInfo } from "../types/project";

const API_BASE = "http://localhost:8000";


// ── Types (mirror OutlineFrontmatterData / OutlineSectionItem in backend) ─────

interface FrontmatterState {
  target_word_count:      string;    // String so <input type="number"> works cleanly
  expected_characters:    string[];
  expected_locations:     string[];
  expected_lore:          string[];
  expected_relationships: string[];
  chapters:               unknown[];  // Round-tripped unchanged; edited in body section
}

interface SectionState {
  heading: string;
  content: string;
}


// ── TagInput ──────────────────────────────────────────────────────────────────
// Chip-style input for a list of strings. Press Enter or comma to add a tag.
// Click × to remove. Backspace on empty input removes the last tag.

interface TagInputProps {
  tags:       string[];
  onAdd:      (value: string) => void;
  onRemove:   (index: number) => void;
  placeholder?: string;
}

function TagInput({ tags, onAdd, onRemove, placeholder = "Type and press Enter" }: TagInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const v = input.trim().replace(/,$/, "").trim();
    if (v && !tags.includes(v)) {
      onAdd(v);
    }
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      onRemove(tags.length - 1);
    }
  }

  return (
    <div
      className="flex min-h-[2rem] flex-wrap items-center gap-1 rounded border border-border bg-bg-base px-2 py-1 focus-within:border-accent cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={i}
          className="flex items-center gap-1 rounded bg-bg-surface px-2 py-0.5 text-xs text-text-primary"
        >
          {tag}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(i); }}
            className="ml-0.5 text-text-muted hover:text-red-400 leading-none"
            title={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[8rem] bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
      />
    </div>
  );
}


// ── SectionCard ───────────────────────────────────────────────────────────────
// One collapsible card for a ## section from the outline body.

interface SectionCardProps {
  section:   SectionState;
  expanded:  boolean;
  onToggle:  () => void;
  onChange:  (content: string) => void;
}

function SectionCard({ section, expanded, onToggle, onChange }: SectionCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea to fit its content whenever it is shown or
  // its content changes. The "auto" trick collapses then re-measures.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !expanded) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [expanded, section.content]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    // Keep height in sync while typing.
    const ta = e.currentTarget;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  // Count non-empty lines for a preview when collapsed.
  const previewLines = section.content
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 2)
    .join(" · ");

  return (
    <div className="rounded border border-border bg-bg-panel overflow-hidden">
      {/* Section header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-bg-surface transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
        )}
        <span className="text-sm font-medium text-text-primary">{section.heading}</span>
        {!expanded && previewLines && (
          <span className="ml-2 truncate text-xs text-text-muted">{previewLines}</span>
        )}
      </button>

      {/* Editable body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <textarea
            ref={textareaRef}
            value={section.content}
            onChange={handleChange}
            spellCheck
            className="w-full resize-none bg-transparent font-mono text-sm text-text-primary outline-none leading-relaxed"
            style={{ minHeight: "6rem" }}
          />
        </div>
      )}
    </div>
  );
}


// ── OutlinePlanner ────────────────────────────────────────────────────────────

export interface OutlinePlannerProps {
  project:        ProjectInfo;
  onBack:         () => void;
  onDirtyChange:  (dirty: boolean) => void;
  // Opens outline.md in the raw Markdown editor (for template switching, power users).
  onSwitchToRaw:  () => void;
}

export function OutlinePlanner({ project, onBack, onDirtyChange, onSwitchToRaw }: OutlinePlannerProps) {

  // ── State ──────────────────────────────────────────────────────────────────

  const [frontmatter, setFrontmatter] = useState<FrontmatterState>({
    target_word_count:      "",
    expected_characters:    [],
    expected_locations:     [],
    expected_lore:          [],
    expected_relationships: [],
    chapters:               [],
  });
  const [preamble,  setPreamble]  = useState("");
  const [sections,  setSections]  = useState<SectionState[]>([]);

  // Which section indices are expanded. Default: all open.
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving,  setIsSaving]  = useState(false);
  const [isDirty,   setIsDirty]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);  // brief "Saved" flash

  // Keep a ref so Ctrl+S handler always sees the latest state without re-registering.
  const saveRef = useRef<() => Promise<void>>(async () => {});


  // ── Mark dirty (local + parent) ────────────────────────────────────────────

  function markDirty() {
    setIsDirty(true);
    onDirtyChange(true);
  }


  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/documents/outline?folder_path=${encodeURIComponent(project.root_path)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? "Failed to load outline.");
        }
        const data = await res.json();
        if (cancelled) return;

        setFrontmatter({
          target_word_count:      data.frontmatter.target_word_count != null
            ? String(data.frontmatter.target_word_count)
            : "",
          expected_characters:    data.frontmatter.expected_characters    ?? [],
          expected_locations:     data.frontmatter.expected_locations     ?? [],
          expected_lore:          data.frontmatter.expected_lore          ?? [],
          expected_relationships: data.frontmatter.expected_relationships ?? [],
          chapters:               data.frontmatter.chapters               ?? [],
        });
        setPreamble(data.preamble ?? "");
        setSections(data.sections ?? []);
        // Start with all sections open so the writer sees the full outline.
        setExpandedSections(new Set((data.sections ?? []).map((_: unknown, i: number) => i)));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load outline.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [project.root_path]);


  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    const rawTarget = frontmatter.target_word_count.trim();
    const target = rawTarget === "" ? null : parseInt(rawTarget, 10);

    const payload = {
      folder_path: project.root_path,
      frontmatter: {
        target_word_count:      target !== null && !isNaN(target) ? target : null,
        expected_characters:    frontmatter.expected_characters,
        expected_locations:     frontmatter.expected_locations,
        expected_lore:          frontmatter.expected_lore,
        expected_relationships: frontmatter.expected_relationships,
        chapters:               frontmatter.chapters,
      },
      preamble,
      sections,
    };

    try {
      const res = await fetch(`${API_BASE}/api/documents/outline`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? "Save failed.");
      }

      setIsDirty(false);
      onDirtyChange(false);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save outline.");
    } finally {
      setIsSaving(false);
    }
  }, [frontmatter, preamble, sections, project.root_path, isSaving, onDirtyChange]);

  // Keep ref in sync so the keyboard handler below always calls the latest version.
  saveRef.current = handleSave;


  // ── Ctrl+S listener ────────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);


  // ── Frontmatter helpers ────────────────────────────────────────────────────

  function updateFm<K extends keyof FrontmatterState>(key: K, value: FrontmatterState[K]) {
    setFrontmatter((prev) => ({ ...prev, [key]: value }));
    markDirty();
  }

  function addTag(key: "expected_characters" | "expected_locations" | "expected_lore" | "expected_relationships", value: string) {
    updateFm(key, [...frontmatter[key], value] as string[]);
  }

  function removeTag(key: "expected_characters" | "expected_locations" | "expected_lore" | "expected_relationships", index: number) {
    updateFm(key, (frontmatter[key] as string[]).filter((_, i) => i !== index));
  }


  // ── Section helpers ────────────────────────────────────────────────────────

  function toggleSection(index: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function updateSectionContent(index: number, content: string) {
    setSections((prev) => prev.map((s, i) => i === index ? { ...s, content } : s));
    markDirty();
  }


  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base">

      {/* ── Title bar ────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-bg-panel px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded p-1 text-text-muted hover:bg-bg-surface hover:text-text-primary transition-colors"
            title="Back to editor"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-text-primary">Planning</span>
          <span className="text-xs text-text-muted">
            {project.title}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {saveFlash && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Saved
            </span>
          )}
          {!saveFlash && isDirty && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400"
              title="You have unsaved changes. Press Ctrl+S to save.">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          )}
          {!saveFlash && !isDirty && !isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Saved
            </span>
          )}
          <button
            onClick={onSwitchToRaw}
            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
            title="Edit outline.md as raw Markdown (template switcher lives here)"
          >
            Raw view
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title="Save outline (Ctrl+S)"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 border-b border-red-800 bg-red-950/40 px-4 py-2">
          <p className="text-xs text-red-300">
            <span className="font-semibold">Error: </span>{error}
          </p>
        </div>
      )}

      {/* ── Main scrollable body ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-text-muted">Loading outline...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-8">

            {/* ── Project Targets card ─────────────────────────────────── */}
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Project Targets
              </h2>
              <div className="rounded border border-border bg-bg-panel p-5 space-y-4">

                {/* Word target */}
                <div className="flex items-center gap-4">
                  <label className="w-36 shrink-0 text-xs text-text-muted">
                    Word target
                  </label>
                  <input
                    type="number"
                    value={frontmatter.target_word_count}
                    onChange={(e) => updateFm("target_word_count", e.target.value)}
                    placeholder="e.g. 90000"
                    min={0}
                    step={1000}
                    className="w-36 rounded border border-border bg-bg-base px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent placeholder:text-text-muted"
                    title="Target total word count for the manuscript"
                  />
                  {frontmatter.target_word_count && !isNaN(parseInt(frontmatter.target_word_count, 10)) && (
                    <span className="text-xs text-text-muted">
                      {parseInt(frontmatter.target_word_count, 10).toLocaleString()} words
                    </span>
                  )}
                </div>

                {/* Expected characters */}
                <div className="flex items-start gap-4">
                  <label className="mt-1 w-36 shrink-0 text-xs text-text-muted">
                    Characters
                  </label>
                  <div className="flex-1">
                    <TagInput
                      tags={frontmatter.expected_characters}
                      onAdd={(v) => addTag("expected_characters", v)}
                      onRemove={(i) => removeTag("expected_characters", i)}
                      placeholder="Add character name, press Enter"
                    />
                    <p className="mt-1 text-xs text-text-muted">
                      Used by the Progress gauge to track profile coverage.
                    </p>
                  </div>
                </div>

                {/* Expected locations */}
                <div className="flex items-start gap-4">
                  <label className="mt-1 w-36 shrink-0 text-xs text-text-muted">
                    Locations
                  </label>
                  <div className="flex-1">
                    <TagInput
                      tags={frontmatter.expected_locations}
                      onAdd={(v) => addTag("expected_locations", v)}
                      onRemove={(i) => removeTag("expected_locations", i)}
                      placeholder="Add location name, press Enter"
                    />
                  </div>
                </div>

                {/* Expected lore */}
                <div className="flex items-start gap-4">
                  <label className="mt-1 w-36 shrink-0 text-xs text-text-muted">
                    Lore
                  </label>
                  <div className="flex-1">
                    <TagInput
                      tags={frontmatter.expected_lore}
                      onAdd={(v) => addTag("expected_lore", v)}
                      onRemove={(i) => removeTag("expected_lore", i)}
                      placeholder="Add lore entry, press Enter"
                    />
                  </div>
                </div>

                {/* Expected relationships */}
                <div className="flex items-start gap-4">
                  <label className="mt-1 w-36 shrink-0 text-xs text-text-muted">
                    Relationships
                  </label>
                  <div className="flex-1">
                    <TagInput
                      tags={frontmatter.expected_relationships}
                      onAdd={(v) => addTag("expected_relationships", v)}
                      onRemove={(i) => removeTag("expected_relationships", i)}
                      placeholder="e.g. Kael & Vire, press Enter"
                    />
                  </div>
                </div>

                {/* Chapters -- read-only hint */}
                {frontmatter.chapters.length > 0 && (
                  <div className="flex items-start gap-4">
                    <label className="mt-0.5 w-36 shrink-0 text-xs text-text-muted">
                      Chapter targets
                    </label>
                    <p className="text-xs text-text-muted">
                      {frontmatter.chapters.length} chapter{frontmatter.chapters.length !== 1 ? "s" : ""} defined.
                      Edit word targets in the "Chapter-by-Chapter Plan" section below.
                    </p>
                  </div>
                )}

              </div>
            </section>

            {/* ── Outline sections ─────────────────────────────────────── */}
            {sections.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Outline Sections
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setExpandedSections(new Set(sections.map((_, i) => i)))}
                      className="text-xs text-text-muted hover:text-text-primary transition-colors"
                    >
                      Expand all
                    </button>
                    <span className="text-text-muted">·</span>
                    <button
                      onClick={() => setExpandedSections(new Set())}
                      className="text-xs text-text-muted hover:text-text-primary transition-colors"
                    >
                      Collapse all
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {sections.map((section, i) => (
                    <SectionCard
                      key={section.heading}
                      section={section}
                      expanded={expandedSections.has(i)}
                      onToggle={() => toggleSection(i)}
                      onChange={(content) => updateSectionContent(i, content)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Empty state ───────────────────────────────────────────── */}
            {sections.length === 0 && !isLoading && (
              <div className="rounded border border-dashed border-border py-12 text-center">
                <p className="text-sm text-text-muted">
                  No sections found in outline.md.
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Add <code className="font-mono">## Section Name</code> headings to create sections here.
                </p>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
