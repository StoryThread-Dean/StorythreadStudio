// ProfileBuilder.tsx -- The Profile Builder Screen
// ==================================================
// This screen is shown when the writer clicks a profile type (Characters,
// Relationships, etc.) in the editor's left navigation panel.
//
// Layout: three panels
//   Left   -- profile type tabs, list of profiles, create new profile button
//   Center -- structured form editor for the selected profile
//   Right  -- conversational calibration chat (Phase 4 placeholder for now)
//
// Data flow:
//   1. On mount (or type change): fetch profile list from backend
//   2. On profile click: fetch full profile from backend, display in form
//   3. As writer edits: update local `profile` state (dirty tracking)
//   4. On Ctrl+S or Save: POST to backend, mark as saved

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, ChevronLeft, Trash2, Download } from "lucide-react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import type { ProjectInfo } from "../types/project";
import type {
  Profile,
  ProfileListItem,
  ProfileSection,
  TraitBlock,
  ProfileType,
  InfluenceLevel,
} from "../types/profile";
import {
  SECTION_CONFIGS,
  PROFILE_TYPE_LABELS,
  INFLUENCE_LABELS,
} from "../types/profile";
import { v4 as uuidv4 } from "uuid";

const API_BASE = "http://localhost:8000";

// ── Props ────────────────────────────────────────────────────────────────────
interface ProfileBuilderProps {
  project: ProjectInfo;
  initialType: ProfileType;  // Which tab to open first (set by nav click)
  onBack: () => void;        // Return to the writing editor
}


// ── ProfileBuilder Component ─────────────────────────────────────────────────
export function ProfileBuilder({ project, initialType, onBack }: ProfileBuilderProps) {

  // Which profile type tab is selected (character / relationship / location / lore)
  const [profileType, setProfileType] = useState<ProfileType>(initialType);

  // The list of profiles shown in the left panel
  const [profileList, setProfileList] = useState<ProfileListItem[]>([]);

  // The profile currently open in the center editor
  const [profile, setProfile] = useState<Profile | null>(null);

  // Dirty flag -- true when the writer has unsaved edits
  const [isDirty, setIsDirty] = useState(false);

  // Loading and error state for the list and the editor
  const [listLoading, setListLoading]   = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Create profile form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName]               = useState("");
  const [newRole, setNewRole]               = useState("");
  const [creating, setCreating]             = useState(false);

  // Refs for Ctrl+S handler (avoids stale closures)
  const profileRef = useRef<Profile | null>(null);
  profileRef.current = profile;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;


  // --- Fetch profile list whenever the type tab changes ---
  const fetchProfileList = useCallback(async (type: ProfileType) => {
    setListLoading(true);
    setError(null);
    setProfile(null);
    setIsDirty(false);

    try {
      const params = new URLSearchParams({ folder_path: project.root_path, type });
      const res = await fetch(`${API_BASE}/api/profiles/list?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Failed to load profiles.");
      }
      const list: ProfileListItem[] = await res.json();
      setProfileList(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profiles.");
      setProfileList([]);
    } finally {
      setListLoading(false);
    }
  }, [project.root_path]);

  useEffect(() => {
    fetchProfileList(profileType);
  }, [profileType, fetchProfileList]);


  // --- Load a profile into the editor ---
  const loadProfile = useCallback(async (item: ProfileListItem) => {
    setEditorLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        folder_path: project.root_path,
        type: item.type,
        filename: item.filename,
      });
      const res = await fetch(`${API_BASE}/api/profiles/profile?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Failed to load profile.");
      }
      const loaded: Profile = await res.json();
      setProfile(loaded);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profile.");
    } finally {
      setEditorLoading(false);
    }
  }, [project.root_path]);


  // --- Save the current profile to disk ---
  const handleSave = useCallback(async () => {
    const p = profileRef.current;
    if (!p) return;

    try {
      const res = await fetch(`${API_BASE}/api/profiles/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: project.root_path,
          filename: p.filename,
          profile: p,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Save failed.");
      }
      const saved: Profile = await res.json();
      setProfile(saved);
      setIsDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    }
  }, [project.root_path]);


  // --- Keyboard shortcut: Ctrl+S ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (isDirtyRef.current) handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);


  // --- Create a new profile ---
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/profiles/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: project.root_path,
          type: profileType,
          name: newName.trim(),
          role: newRole.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Failed to create profile.");
      }
      const created: Profile = await res.json();

      // Refresh list and open the new profile
      await fetchProfileList(profileType);
      setProfile(created);
      setIsDirty(false);
      setShowCreateForm(false);
      setNewName("");
      setNewRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create profile.");
    } finally {
      setCreating(false);
    }
  };


  // --- Import a character profile from another project ---
  // Opens the OS file picker via Tauri, then POSTs to the backend to copy
  // the file as an independent fork. Only available for the character type.
  const handleImport = async () => {
    setError(null);

    // Open a file picker filtered to .md files
    const selected = await openFilePicker({
      multiple: false,
      title: "Select a character profile to import",
      filters: [{ name: "Markdown Profile", extensions: ["md"] }],
    });

    if (!selected || typeof selected !== "string") return;  // User cancelled

    try {
      const res = await fetch(`${API_BASE}/api/profiles/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: project.root_path,
          source_path: selected,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Import failed.");
      }

      const imported: Profile = await res.json();

      // Refresh the character list and open the newly imported profile
      await fetchProfileList("character");
      setProfile(imported);
      setIsDirty(false);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import profile.");
    }
  };


  // --- Profile field updaters ---
  // These helpers update nested profile state immutably.
  // "Immutably" means we never mutate the existing object -- we always
  // create a new copy with the change applied. React requires this to
  // detect that state has changed and re-render the component.

  function updateProfileField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile(prev => prev ? { ...prev, [key]: value } : prev);
    setIsDirty(true);
  }

  function updateSection(sectionKey: string, updates: Partial<ProfileSection>) {
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: { ...prev.sections[sectionKey], ...updates },
        },
      };
    });
    setIsDirty(true);
  }

  function addTraitBlock(sectionKey: string) {
    const newBlock: TraitBlock = {
      id: uuidv4(),
      trait: "",
      description: "",
      influence: "minor",
      ai_usage_example: "",
      notes: "",
    };
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: [...prev.sections[sectionKey].trait_blocks, newBlock],
          },
        },
      };
    });
    setIsDirty(true);
  }

  function updateTraitBlock(sectionKey: string, blockId: string, updates: Partial<TraitBlock>) {
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: prev.sections[sectionKey].trait_blocks.map(b =>
              b.id === blockId ? { ...b, ...updates } : b
            ),
          },
        },
      };
    });
    setIsDirty(true);
  }

  function removeTraitBlock(sectionKey: string, blockId: string) {
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: prev.sections[sectionKey].trait_blocks.filter(b => b.id !== blockId),
          },
        },
      };
    });
    setIsDirty(true);
  }


  // ── Render ────────────────────────────────────────────────────────────────
  const sections = profile ? SECTION_CONFIGS[profile.type as ProfileType] ?? [] : [];

  return (
    <div className="flex h-screen overflow-hidden bg-[#070724] text-[#f0f0f5]">

      {/* ── LEFT PANEL: Type Tabs + Profile List ───────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#1e1e4a] bg-[#0d0d2b]">

        {/* Back to writing button */}
        <div className="border-b border-[#1e1e4a] px-3 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-[#f0f0f5]"
            title="Return to the writing editor"
          >
            <ChevronLeft size={13} />
            Back to Writing
          </button>
        </div>

        {/* Profile type tabs */}
        <div className="border-b border-[#1e1e4a] px-3 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
            Profile Type
          </p>
          <div className="flex flex-col gap-1">
            {(Object.keys(PROFILE_TYPE_LABELS) as ProfileType[]).map(type => (
              <button
                key={type}
                onClick={() => {
                  if (type !== profileType) setProfileType(type);
                }}
                className={`rounded px-2 py-1.5 text-left text-sm transition-colors ${
                  profileType === type
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "text-[#f0f0f5] hover:bg-[#12122e]"
                }`}
              >
                {PROFILE_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Profile list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
              {PROFILE_TYPE_LABELS[profileType]}
            </p>
            <div className="flex items-center gap-1">
              {/* Import button -- character only, per spec */}
              {profileType === "character" && (
                <button
                  onClick={handleImport}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-indigo-300"
                  title="Import a character profile from another project as an independent copy"
                >
                  <Download size={12} /> Import
                </button>
              )}
              <button
                onClick={() => { setShowCreateForm(true); setNewName(""); setNewRole(""); }}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-indigo-300"
                title={`Create a new ${profileType} profile`}
              >
                <Plus size={12} /> New
              </button>
            </div>
          </div>

          {listLoading && (
            <p className="text-xs text-[#3f3f7a]">Loading...</p>
          )}

          {!listLoading && profileList.length === 0 && (
            <p className="text-xs text-[#3f3f7a]">
              No {PROFILE_TYPE_LABELS[profileType].toLowerCase()} yet.
              Click New to create one.
            </p>
          )}

          {profileList.map(item => (
            <button
              key={item.filename}
              onClick={() => loadProfile(item)}
              className={`mb-0.5 w-full rounded px-2 py-1.5 text-left transition-colors ${
                profile?.filename === item.filename
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-[#f0f0f5] hover:bg-[#12122e]"
              }`}
              title={item.role ? `${item.role} -- ${item.filename}` : item.filename}
            >
              <p className="truncate text-sm">{item.name}</p>
              {item.role && (
                <p className="truncate text-xs text-[#8888aa]">{item.role}</p>
              )}
            </button>
          ))}
        </div>
      </aside>


      {/* ── CENTER PANEL: Profile Editor ───────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Title bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e1e4a] bg-[#0d0d2b] px-4 py-2">
          <span className="text-sm font-medium text-[#f0f0f5]">
            {profile ? profile.name : "Profile Builder"}
          </span>
          <div className="flex items-center gap-2">
            {profile && (
              isDirty ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Unsaved changes
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Saved
                </span>
              )
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || !profile}
              className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-[#f0f0f5] disabled:cursor-not-allowed disabled:opacity-40"
              title="Save profile to disk (Ctrl+S)"
            >
              Save
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="shrink-0 border-b border-red-800 bg-red-950/40 px-4 py-2">
            <p className="text-xs text-red-300">
              <span className="font-semibold">Error: </span>{error}
            </p>
          </div>
        )}

        {/* Create profile form (shown as an overlay panel instead of a modal) */}
        {showCreateForm && (
          <div className="shrink-0 border-b border-[#1e1e4a] bg-[#0d0d2b] px-4 py-4">
            <p className="mb-3 text-sm font-semibold text-[#f0f0f5]">
              New {PROFILE_TYPE_LABELS[profileType].slice(0, -1)} {/* Remove trailing 's' */}
            </p>
            <label className="mb-1 block text-xs text-[#8888aa]">
              Name <span className="text-indigo-400">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              autoFocus
              placeholder={profileType === "character" ? "e.g. Elara Voss" : "e.g. Northwatch Harbor"}
              className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
            />
            {profileType === "character" && (
              <>
                <label className="mb-1 block text-xs text-[#8888aa]">Role (optional)</label>
                <input
                  type="text"
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. protagonist, mentor, antagonist"
                  className="mb-3 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                />
              </>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="rounded border border-[#1e1e4a] px-3 py-1.5 text-xs text-[#8888aa] transition-colors hover:text-[#f0f0f5]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Editor area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {editorLoading && (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-[#8888aa]">Loading profile...</p>
            </div>
          )}

          {!editorLoading && !profile && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="mb-2 text-sm text-[#8888aa]">
                Select a profile from the left panel, or create a new one.
              </p>
              <p className="text-xs text-[#3f3f7a]">
                Profiles store character details, traits, and context that AI can reference.
              </p>
            </div>
          )}

          {!editorLoading && profile && (
            <div className="mx-auto max-w-2xl">

              {/* Profile header -- name, role, status, tags */}
              <div className="mb-6 rounded border border-[#1e1e4a] bg-[#0d0d2b] p-4">
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-[#8888aa]">Name</label>
                    <input
                      type="text"
                      value={profile.name}
                      onChange={e => updateProfileField("name", e.target.value)}
                      className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#8888aa]">Role</label>
                    <input
                      type="text"
                      value={profile.role}
                      onChange={e => updateProfileField("role", e.target.value)}
                      placeholder="e.g. protagonist"
                      className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-[#8888aa]">Status</label>
                    <select
                      value={profile.status}
                      onChange={e => updateProfileField("status", e.target.value)}
                      className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] outline-none focus:border-indigo-500"
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#8888aa]">
                      Tags <span className="text-[#3f3f7a]">(comma-separated)</span>
                    </label>
                    <input
                      type="text"
                      value={profile.tags.join(", ")}
                      onChange={e => updateProfileField(
                        "tags",
                        e.target.value.split(",").map(t => t.trim()).filter(Boolean)
                      )}
                      placeholder="e.g. strategist, guarded, grief"
                      className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Profile sections */}
              {sections.map(cfg => {
                const section = profile.sections[cfg.key] ?? {
                  content: "", trait_blocks: [], ai_summary: "",
                };
                return (
                  <ProfileSectionEditor
                    key={cfg.key}
                    sectionKey={cfg.key}
                    heading={cfg.heading}
                    hasTraitBlocks={cfg.hasTraitBlocks}
                    section={section}
                    onContentChange={content => updateSection(cfg.key, { content })}
                    onAiSummaryChange={ai_summary => updateSection(cfg.key, { ai_summary })}
                    onAddTraitBlock={() => addTraitBlock(cfg.key)}
                    onUpdateTraitBlock={(id, updates) => updateTraitBlock(cfg.key, id, updates)}
                    onRemoveTraitBlock={id => removeTraitBlock(cfg.key, id)}
                  />
                );
              })}

              {/* Full AI Summary / Generated Summary
                  For chapter/scene types this field IS the usable summary.
                  For other types it's a generated AI profile summary. */}
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#f0f0f5]">
                    {profile.type === "chapter_summary"
                      ? "Chapter Summary"
                      : profile.type === "scene_summary"
                      ? "Scene Summary"
                      : "Full AI Summary"}
                  </h2>
                  <span
                    className="text-xs text-[#3f3f7a]"
                    title={
                      profile.type === "chapter_summary" || profile.type === "scene_summary"
                        ? "This is the summary text used as AI context. Write it manually or generate it in Phase 4."
                        : "This section is generated by AI on demand (Phase 4). You can edit it manually."
                    }
                  >
                    {profile.type === "chapter_summary" || profile.type === "scene_summary"
                      ? "Used as AI context chip"
                      : "AI-generated"}
                  </span>
                </div>
                <textarea
                  value={profile.full_ai_summary}
                  onChange={e => updateProfileField("full_ai_summary", e.target.value)}
                  placeholder={
                    profile.type === "chapter_summary"
                      ? "Write a concise summary of this chapter for use as AI context..."
                      : profile.type === "scene_summary"
                      ? "Write a concise summary of this scene for use as AI context..."
                      : "Generated on demand in Phase 4. You can write here manually for now."
                  }
                  rows={5}
                  className="w-full resize-y rounded border border-[#1e1e4a] bg-[#0d0d2b] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                />
              </div>

            </div>
          )}
        </div>
      </main>


      {/* ── RIGHT PANEL: Calibration Chat (Phase 4 placeholder) ─────────── */}
      <aside className="flex w-72 shrink-0 flex-col border-l border-[#1e1e4a] bg-[#0d0d2b]">
        <div className="border-b border-[#1e1e4a] px-4 py-5">
          <h2 className="text-sm font-semibold text-[#f0f0f5]">Profile Chat</h2>
          <p className="mt-1 text-xs text-[#8888aa]">
            Conversational profile calibration. Ask questions, refine traits,
            and explore how AI interprets this profile.
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="text-center">
            <p className="text-xs text-[#3f3f7a]">
              Profile chat is coming in Phase 4.
            </p>
            <p className="mt-1 text-xs text-[#3f3f7a]">
              It will let you refine this profile through conversation
              without auto-updating any of your written fields.
            </p>
          </div>
        </div>
      </aside>

    </div>
  );
}


// ── ProfileSectionEditor ──────────────────────────────────────────────────────
// Renders one section of the profile -- either a plain textarea or a list of
// trait block cards, followed by an AI summary textarea.

interface ProfileSectionEditorProps {
  sectionKey: string;
  heading: string;
  hasTraitBlocks: boolean;
  section: ProfileSection;
  onContentChange: (content: string) => void;
  onAiSummaryChange: (ai_summary: string) => void;
  onAddTraitBlock: () => void;
  onUpdateTraitBlock: (id: string, updates: Partial<TraitBlock>) => void;
  onRemoveTraitBlock: (id: string) => void;
}

function ProfileSectionEditor({
  heading,
  hasTraitBlocks,
  section,
  onContentChange,
  onAiSummaryChange,
  onAddTraitBlock,
  onUpdateTraitBlock,
  onRemoveTraitBlock,
}: ProfileSectionEditorProps) {
  return (
    <div className="mb-6">
      {/* Section heading */}
      <h2 className="mb-3 border-b border-[#1e1e4a] pb-1 text-sm font-semibold text-[#f0f0f5]">
        {heading}
      </h2>

      {hasTraitBlocks ? (
        // Trait block section
        <div>
          {section.trait_blocks.length === 0 && (
            <p className="mb-2 text-xs text-[#3f3f7a]">
              No traits yet. Click "Add Trait" to add one.
            </p>
          )}
          {section.trait_blocks.map(block => (
            <TraitBlockCard
              key={block.id}
              block={block}
              onUpdate={updates => onUpdateTraitBlock(block.id, updates)}
              onRemove={() => onRemoveTraitBlock(block.id)}
            />
          ))}
          <button
            onClick={onAddTraitBlock}
            className="mb-3 flex items-center gap-1 rounded border border-dashed border-[#1e1e4a] px-3 py-1.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300"
            title="Add a trait or group of related traits to this section"
          >
            <Plus size={12} /> Add Trait
          </button>
        </div>
      ) : (
        // Plain text section
        <textarea
          value={section.content}
          onChange={e => onContentChange(e.target.value)}
          placeholder={`Write ${heading.toLowerCase()} notes here...`}
          rows={4}
          className="mb-3 w-full resize-y rounded border border-[#1e1e4a] bg-[#0d0d2b] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
        />
      )}

      {/* AI Summary sub-section */}
      <div className="rounded border border-[#1e1e4a] bg-[#070724] p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-[#8888aa]">AI Summary: {heading}</p>
          <span
            className="text-xs text-[#3f3f7a]"
            title="This field is intended for AI-generated summaries (Phase 4). You can write here manually."
          >
            AI-generated
          </span>
        </div>
        <textarea
          value={section.ai_summary}
          onChange={e => onAiSummaryChange(e.target.value)}
          placeholder="AI summary generated on demand in Phase 4. Editable by you."
          rows={2}
          className="w-full resize-y rounded border border-[#1e1e4a] bg-[#0d0d2b] px-2 py-1.5 text-xs text-[#8888aa] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}


// ── TraitBlockCard ─────────────────────────────────────────────────────────────
// Renders one trait block as an editable card.
// Each card has: trait name, description, influence dropdown, AI usage example, notes.

interface TraitBlockCardProps {
  block: TraitBlock;
  onUpdate: (updates: Partial<TraitBlock>) => void;
  onRemove: () => void;
}

function TraitBlockCard({ block, onUpdate, onRemove }: TraitBlockCardProps) {
  return (
    <div className="mb-3 rounded border border-[#1e1e4a] bg-[#0d0d2b] p-3">

      {/* Trait name + remove button */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex-1">
          <label className="mb-0.5 block text-xs text-[#8888aa]">
            Trait(s)
            <span className="ml-1 text-[#3f3f7a]">-- one trait or a comma-separated group</span>
          </label>
          <input
            type="text"
            value={block.trait}
            onChange={e => onUpdate({ trait: e.target.value })}
            placeholder="e.g. observant, punctual, eloquent"
            className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
          />
        </div>
        <button
          onClick={onRemove}
          className="mt-5 shrink-0 rounded p-1 text-[#3f3f7a] transition-colors hover:bg-red-950/40 hover:text-red-400"
          title="Remove this trait block"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Description */}
      <div className="mb-2">
        <label className="mb-0.5 block text-xs text-[#8888aa]">Description</label>
        <textarea
          value={block.description}
          onChange={e => onUpdate({ description: e.target.value })}
          placeholder="Human-written description of this trait..."
          rows={2}
          className="w-full resize-y rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
        />
      </div>

      {/* Influence scale */}
      <div className="mb-2">
        <label className="mb-0.5 block text-xs text-[#8888aa]">
          Influence
          <span className="ml-1 text-[#3f3f7a]">-- how prominently AI surfaces this trait</span>
        </label>
        <select
          value={block.influence}
          onChange={e => onUpdate({ influence: e.target.value as InfluenceLevel })}
          className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] outline-none focus:border-indigo-500"
        >
          {(Object.entries(INFLUENCE_LABELS) as [InfluenceLevel, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* AI Usage Example */}
      <div className="mb-2 rounded border border-[#1e1e4a] bg-[#070724] p-2">
        <label className="mb-0.5 block text-xs text-[#8888aa]">
          AI Usage Example
          <span className="ml-1 text-[#3f3f7a]">-- how AI should apply this trait in suggestions</span>
        </label>
        <textarea
          value={block.ai_usage_example}
          onChange={e => onUpdate({ ai_usage_example: e.target.value })}
          placeholder="Generated by AI on demand in Phase 4. You can write here manually."
          rows={2}
          className="w-full resize-y rounded border border-[#1e1e4a] bg-[#0d0d2b] px-2 py-1.5 text-xs text-[#8888aa] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
        />
      </div>

      {/* Notes (optional) */}
      <div>
        <label className="mb-0.5 block text-xs text-[#8888aa]">
          Notes <span className="text-[#3f3f7a]">(optional)</span>
        </label>
        <input
          type="text"
          value={block.notes}
          onChange={e => onUpdate({ notes: e.target.value })}
          placeholder="Supporting context or clarification..."
          className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}
