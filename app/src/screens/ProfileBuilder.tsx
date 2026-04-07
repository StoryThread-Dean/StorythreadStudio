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

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { Plus, ChevronLeft, Trash2, Download, Sparkles, Send, Bot, X } from "lucide-react";
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
import type { ProfileChatMessage } from "../types/ai";
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

  // --- Phase 4: Generation state ---
  // Tracks which field is currently being generated so we can show a spinner
  // and disable double-clicks. Format: "section_key" or "section_key:block_id"
  const [generatingField, setGeneratingField] = useState<string | null>(null);

  // --- Phase 4: Profile Builder Chat state ---
  // The chat is session-only -- history lives in React state, never on the server.
  // When the component unmounts (writer navigates away), the conversation is gone.
  const [chatMessages, setChatMessages]   = useState<ProfileChatMessage[]>([]);
  const [chatInput, setChatInput]         = useState("");
  const [chatLoading, setChatLoading]     = useState(false);
  const [chatError, setChatError]         = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Guide mode -- structured character-building coaching session.
  // When active, the system prompt switches to a focused interview mode.
  const [guideMode, setGuideMode] = useState(false);

  // Reset chat and guide mode when the profile changes
  useEffect(() => {
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setGuideMode(false);
  }, [profile?.filename]);


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


  // --- Format the current profile into a readable text block for AI context ---
  // Used by both generate-full-summary and the chat system prompt.
  function formatProfileForAI(p: Profile): string {
    const configs = SECTION_CONFIGS[p.type as ProfileType] ?? [];
    const lines: string[] = [`Profile: ${p.name} (${p.type})`, `Role: ${p.role || "unspecified"}`, ""];

    for (const cfg of configs) {
      const section = p.sections[cfg.key];
      if (!section) continue;
      lines.push(`## ${cfg.heading}`);
      if (cfg.hasTraitBlocks && section.trait_blocks.length > 0) {
        for (const block of section.trait_blocks) {
          lines.push(`- ${block.trait} [${block.influence}]: ${block.description}`);
          if (block.ai_usage_example) lines.push(`  Usage: ${block.ai_usage_example}`);
        }
      } else if (section.content) {
        lines.push(section.content);
      }
      lines.push("");
    }

    if (p.full_ai_summary) {
      lines.push("## Full AI Summary");
      lines.push(p.full_ai_summary);
    }

    return lines.join("\n");
  }


  // --- Generate ai_usage_example for a trait block ---
  async function generateUsageExample(sectionKey: string, block: TraitBlock, sectionHeading: string) {
    if (!profile) return;
    const fieldKey = `${sectionKey}:${block.id}`;
    setGeneratingField(fieldKey);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-usage-example`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name:    profile.name,
          profile_type:    profile.type,
          section_heading: sectionHeading,
          trait:           block.trait,
          description:     block.description,
          influence:       block.influence,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Generation failed.");
      }

      const data = await res.json();
      // Update the trait block's ai_usage_example field in state
      updateTraitBlock(sectionKey, block.id, { ai_usage_example: data.ai_usage_example });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate usage example.");
    } finally {
      setGeneratingField(null);
    }
  }


  // --- Generate AI summary for one section ---
  async function generateSectionSummary(sectionKey: string, sectionHeading: string) {
    if (!profile) return;
    setGeneratingField(sectionKey);
    setError(null);

    const section = profile.sections[sectionKey];
    // Format the section content for the AI
    const cfg = (SECTION_CONFIGS[profile.type as ProfileType] ?? [])
      .find(c => c.key === sectionKey);

    let contentText = "";
    if (cfg?.hasTraitBlocks && section.trait_blocks.length > 0) {
      contentText = section.trait_blocks
        .map(b => `- ${b.trait} [${b.influence}]: ${b.description}`)
        .join("\n");
    } else {
      contentText = section.content;
    }

    if (!contentText.trim()) {
      setError("Section is empty -- add some content before generating a summary.");
      setGeneratingField(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-section-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name:    profile.name,
          profile_type:    profile.type,
          section_heading: sectionHeading,
          section_content: contentText,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Generation failed.");
      }

      const data = await res.json();
      updateSection(sectionKey, { ai_summary: data.section_summary });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate section summary.");
    } finally {
      setGeneratingField(null);
    }
  }


  // --- Generate the full profile AI summary ---
  async function generateFullSummary() {
    if (!profile) return;
    setGeneratingField("full_summary");
    setError(null);

    const contentText = formatProfileForAI(profile);

    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-full-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name:    profile.name,
          profile_type:    profile.type,
          profile_content: contentText,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Generation failed.");
      }

      const data = await res.json();
      updateProfileField("full_ai_summary", data.full_summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate full summary.");
    } finally {
      setGeneratingField(null);
    }
  }


  // --- Activate Guide Mode ---
  // Sends the first automated message that opens the coaching session.
  // Detects whether the profile is blank or has existing content to decide
  // what to ask first.
  async function activateGuideMode() {
    if (!profile) return;
    setGuideMode(true);
    setChatMessages([]);
    setChatError(null);

    // Determine if the profile is effectively blank
    const hasContent = profile.full_ai_summary.trim().length > 0
      || Object.values(profile.sections).some(
          s => s.content.trim().length > 0 || s.trait_blocks.length > 0
        );

    const openingMessage = hasContent
      ? `I'd like your help developing ${profile.name}'s profile further. ` +
        `Please look at what I've already built and ask me where I'd like to start -- ` +
        `whether that's refining an existing section or working on something that's still empty.`
      : `I'd like to build ${profile.name}'s profile from scratch. ` +
        `Please guide me through it section by section, starting from the beginning.`;

    // Pre-populate the chat with the user's opening message and immediately send it
    const firstMessage = { role: "user" as const, content: openingMessage };
    setChatMessages([firstMessage]);
    setChatLoading(true);

    const sectionKeys = (SECTION_CONFIGS[profile.type as ProfileType] ?? []).map(c => c.key);

    try {
      const res = await fetch(`${API_BASE}/api/ai/profile-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name:    profile.name,
          profile_type:    profile.type,
          profile_content: formatProfileForAI(profile),
          messages:        [firstMessage],
          guide_mode:      true,
          all_sections:    sectionKeys,
          content_mode:    project.content_mode_default ?? "general",
          is_blank:        !hasContent,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Guide mode failed to start.");
      }

      const data = await res.json();
      setChatMessages([firstMessage, { role: "assistant", content: data.reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not start guide mode.");
      setGuideMode(false);
    } finally {
      setChatLoading(false);
    }
  }


  // --- Send a chat message to the Profile Builder chat ---
  async function sendChatMessage() {
    if (!profile || !chatInput.trim() || chatLoading) return;

    const userMessage: ProfileChatMessage = { role: "user", content: chatInput.trim() };
    const newMessages = [...chatMessages, userMessage];

    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    // Scroll to the bottom after adding the user message
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const sectionKeys = (SECTION_CONFIGS[profile.type as ProfileType] ?? []).map(c => c.key);

      const res = await fetch(`${API_BASE}/api/ai/profile-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name:    profile.name,
          profile_type:    profile.type,
          profile_content: formatProfileForAI(profile),
          messages:        newMessages,
          guide_mode:      guideMode,
          all_sections:    sectionKeys,
          content_mode:    project.content_mode_default ?? "general",
          is_blank:        false,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Chat request failed.");
      }

      const data = await res.json();
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Chat request failed.");
    } finally {
      setChatLoading(false);
    }
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
            {/* Guide Mode Button -- opens the AI character-building coach in the right panel */}
            {profile && (
              <button
                onClick={activateGuideMode}
                disabled={chatLoading}
                className="flex items-center gap-1.5 rounded border border-indigo-800/60 bg-indigo-900/20 px-2.5 py-1 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:bg-indigo-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                title="Open an AI-guided character-building session in the chat panel. The coach will ask focused questions to help you develop this profile section by section."
              >
                <Bot size={12} />
                Help Me Build This Character
              </button>
            )}

            {profile && (
              isDirty ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Unsaved
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
                    onGenerateSectionSummary={() => generateSectionSummary(cfg.key, cfg.heading)}
                    onGenerateUsageExample={(block) => generateUsageExample(cfg.key, block, cfg.heading)}
                    generatingField={generatingField}
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
                  <button
                    onClick={generateFullSummary}
                    disabled={generatingField === "full_summary"}
                    className="flex items-center gap-1 rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Generate this summary using AI based on the profile content above"
                  >
                    <Sparkles size={11} />
                    {generatingField === "full_summary" ? "Generating..." : "Generate"}
                  </button>
                </div>
                {/* AutoTextarea expands to show full generated summary without scrolling */}
                <AutoTextarea
                  value={profile.full_ai_summary}
                  onChange={e => updateProfileField("full_ai_summary", e.target.value)}
                  placeholder={
                    profile.type === "chapter_summary"
                      ? "Write a concise summary of this chapter for use as AI context..."
                      : profile.type === "scene_summary"
                      ? "Write a concise summary of this scene for use as AI context..."
                      : "Click Generate to create a full AI profile summary, or write one manually."
                  }
                  className="w-full rounded border border-[#1e1e4a] bg-[#0d0d2b] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
                  minRows={4}
                />
              </div>

            </div>
          )}
        </div>
      </main>


      {/* ── RIGHT PANEL: Profile Builder Chat ─────────────────────────── */}
      {/* The chat is session-only. History lives in React state.
          When you close the Profile Builder, the conversation is cleared.
          The AI never auto-updates your profile fields -- all edits are manual. */}
      <aside className="flex w-72 shrink-0 flex-col border-l border-[#1e1e4a] bg-[#0d0d2b]">

        <div className="border-b border-[#1e1e4a] px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#f0f0f5]">Profile Chat</h2>
            {guideMode && (
              <div className="flex items-center gap-2">
                {/* Guide mode active badge */}
                <span className="flex items-center gap-1 rounded border border-indigo-800/50 bg-indigo-900/30 px-2 py-0.5 text-xs text-indigo-300">
                  <Bot size={10} /> Guide Mode
                </span>
                {/* Exit guide mode */}
                <button
                  onClick={() => { setGuideMode(false); setChatMessages([]); setChatError(null); }}
                  className="rounded p-0.5 text-[#3f3f7a] transition-colors hover:text-[#8888aa]"
                  title="Exit guide mode and clear the conversation"
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-[#8888aa]">
            {guideMode
              ? "AI is guiding you through this profile section by section. Say \"next\" to advance."
              : "Ask how AI interprets this profile, refine traits, and brainstorm. Session-only."
            }
          </p>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {!profile && (
            <p className="text-xs text-[#3f3f7a]">Open a profile to start chatting.</p>
          )}

          {profile && chatMessages.length === 0 && (
            <div className="text-center">
              <p className="text-xs text-[#3f3f7a]">
                Chat about <span className="text-[#8888aa]">{profile.name}</span>.
              </p>
              <p className="mt-1 text-xs text-[#3f3f7a]">
                Try: "How would AI use the core traits?" or
                "What's missing from this profile?"
              </p>
            </div>
          )}

          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`mb-3 ${msg.role === "user" ? "text-right" : "text-left"}`}
            >
              <div
                className={`inline-block max-w-[90%] rounded px-3 py-2 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600/30 text-indigo-100"
                    : "border border-[#1e1e4a] bg-[#12122e] text-[#f0f0f5]"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex items-center gap-2 text-xs text-[#8888aa]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              Thinking...
            </div>
          )}

          {chatError && (
            <div className="rounded border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{chatError}</p>
            </div>
          )}

          {/* Invisible element used to scroll to the bottom */}
          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <div className="border-t border-[#1e1e4a] p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChatMessage()}
              placeholder={profile ? "Ask about this profile..." : "Open a profile first"}
              disabled={!profile || chatLoading}
              className="flex-1 rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-xs text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              onClick={sendChatMessage}
              disabled={!profile || !chatInput.trim() || chatLoading}
              className="flex items-center justify-center rounded border border-[#1e1e4a] p-1.5 text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send message (Enter)"
            >
              <Send size={13} />
            </button>
          </div>
          {chatMessages.length > 0 && (
            <button
              onClick={() => { setChatMessages([]); setChatError(null); }}
              className="mt-1.5 text-xs text-[#3f3f7a] transition-colors hover:text-[#8888aa]"
            >
              Clear conversation
            </button>
          )}
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
  // Phase 4 generation callbacks
  onGenerateSectionSummary: () => void;
  onGenerateUsageExample: (block: TraitBlock) => void;
  generatingField: string | null;
}

function ProfileSectionEditor({
  sectionKey,
  heading,
  hasTraitBlocks,
  section,
  onContentChange,
  onAiSummaryChange,
  onAddTraitBlock,
  onUpdateTraitBlock,
  onRemoveTraitBlock,
  onGenerateSectionSummary,
  onGenerateUsageExample,
  generatingField,
}: ProfileSectionEditorProps) {
  const isGeneratingSummary = generatingField === sectionKey;

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
              onGenerateUsageExample={() => onGenerateUsageExample(block)}
              isGenerating={generatingField === `${sectionKey}:${block.id}`}
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
          <button
            onClick={onGenerateSectionSummary}
            disabled={isGeneratingSummary}
            className="flex items-center gap-1 rounded border border-[#1e1e4a] px-1.5 py-0.5 text-xs text-[#3f3f7a] transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            title="Generate this section summary using AI"
          >
            <Sparkles size={10} />
            {isGeneratingSummary ? "Generating..." : "Generate"}
          </button>
        </div>
        {/* AutoTextarea expands to show full generated content without scrolling */}
        <AutoTextarea
          value={section.ai_summary}
          onChange={e => onAiSummaryChange(e.target.value)}
          placeholder="Click Generate to create an AI summary, or write one manually."
          className="w-full rounded border border-[#1e1e4a] bg-[#0d0d2b] px-2 py-1.5 text-xs text-[#8888aa] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
          minRows={2}
        />
      </div>
    </div>
  );
}


// ── AutoTextarea ──────────────────────────────────────────────────────────────
// A textarea that automatically grows vertically to fit its content.
// This eliminates scrollbars inside AI-generated text fields -- the writer
// can see all the generated text without manually resizing.
//
// How it works: useLayoutEffect runs synchronously after every render
// (including when `value` changes). It resets the height to "auto" first
// (shrinks to minimum), then reads scrollHeight (the natural height needed
// to show all content), and sets that as the explicit height.
// overflow: hidden prevents a scrollbar from briefly appearing during resize.

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 2,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";                         // Shrink first
    el.style.height = `${el.scrollHeight}px`;         // Expand to content
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      rows={minRows}
      style={{ resize: "none", overflow: "hidden" }}  // No manual resize, no scrollbar
    />
  );
}


// ── Influence Color Map ───────────────────────────────────────────────────────
// Maps each influence level to Tailwind classes for the card's left border
// and the influence badge. Color communicates importance at a glance:
//   foreshadowing = purple (hidden, rarely surfaced)
//   background    = slate  (in canon, rarely mentioned)
//   minor         = sky    (subtle, contextual)
//   major         = amber  (regularly visible)
//   core          = rose   (central to identity)
const INFLUENCE_STYLES: Record<string, { border: string; badge: string }> = {
  foreshadowing: { border: "border-l-purple-500",  badge: "border-purple-700/60 bg-purple-900/30 text-purple-300"  },
  background:    { border: "border-l-slate-500",   badge: "border-slate-600/60 bg-slate-800/40 text-slate-400"     },
  minor:         { border: "border-l-sky-500",     badge: "border-sky-700/60 bg-sky-900/30 text-sky-300"           },
  major:         { border: "border-l-amber-500",   badge: "border-amber-700/60 bg-amber-900/30 text-amber-300"     },
  core:          { border: "border-l-rose-500",    badge: "border-rose-700/60 bg-rose-900/30 text-rose-300"        },
};


// ── TraitBlockCard ─────────────────────────────────────────────────────────────
// Renders one trait block as an editable card.
// Color-coded left border shows influence level at a glance.

interface TraitBlockCardProps {
  block: TraitBlock;
  onUpdate: (updates: Partial<TraitBlock>) => void;
  onRemove: () => void;
  onGenerateUsageExample: () => void;
  isGenerating: boolean;
}

function TraitBlockCard({ block, onUpdate, onRemove, onGenerateUsageExample, isGenerating }: TraitBlockCardProps) {
  const influence = block.influence as InfluenceLevel;
  const style = INFLUENCE_STYLES[influence] ?? INFLUENCE_STYLES.minor;

  return (
    // Card: left border colored by influence level for instant visual recognition.
    // border-l-4 = 4px thick left border (the color stripe).
    <div className={`mb-5 rounded border border-[#1e1e4a] border-l-4 ${style.border} bg-[#0d0d2b]`}>

      {/* Card header: trait name + influence badge + remove */}
      <div className="flex items-start gap-2 border-b border-[#1e1e4a] px-3 py-2.5">
        <div className="flex-1">
          <input
            type="text"
            value={block.trait}
            onChange={e => onUpdate({ trait: e.target.value })}
            placeholder="Trait name(s) -- e.g. observant, punctual, eloquent"
            className="w-full bg-transparent text-sm font-medium text-[#f0f0f5] placeholder-[#3f3f7a] outline-none"
          />
          <p className="mt-0.5 text-xs text-[#3f3f7a]">
            One trait or a comma-separated group of related traits
          </p>
        </div>
        {/* Influence badge */}
        <span className={`shrink-0 rounded border px-2 py-0.5 text-xs capitalize ${style.badge}`}>
          {block.influence}
        </span>
        <button
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-[#3f3f7a] transition-colors hover:bg-red-950/40 hover:text-red-400"
          title="Remove this trait block"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Card body */}
      <div className="space-y-3 px-3 py-3">

        {/* Description */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[#8888aa]">Description</label>
          <AutoTextarea
            value={block.description}
            onChange={e => onUpdate({ description: e.target.value })}
            placeholder="Human-written description of this trait..."
            className="w-full rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
            minRows={2}
          />
        </div>

        {/* Influence selector */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[#8888aa]">
            Influence Level
            <span className="ml-1 font-normal text-[#3f3f7a]">-- how prominently AI surfaces this trait</span>
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
        <div className="rounded border border-[#1e1e4a] bg-[#070724] p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-[#8888aa]">
              AI Usage Example
              <span className="ml-1 font-normal text-[#3f3f7a]">-- how AI applies this trait in suggestions</span>
            </label>
            <button
              onMouseDown={(e) => { e.preventDefault(); onGenerateUsageExample(); }}
              disabled={isGenerating || !block.trait.trim() || !block.description.trim()}
              className="flex items-center gap-1 rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#3f3f7a] transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Generate an AI usage example (requires trait and description)"
            >
              <Sparkles size={10} />
              {isGenerating ? "Generating..." : "Generate"}
            </button>
          </div>
          <AutoTextarea
            value={block.ai_usage_example}
            onChange={e => onUpdate({ ai_usage_example: e.target.value })}
            placeholder="Click Generate to create an example, or write one manually."
            className="w-full rounded border border-[#1e1e4a] bg-[#0d0d2b] px-2 py-1.5 text-xs text-[#8888aa] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
            minRows={2}
          />
        </div>

        {/* Notes (optional) */}
        <div>
          <label className="mb-1 block text-xs text-[#8888aa]">
            Notes <span className="text-[#3f3f7a]">(optional -- supporting context)</span>
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
    </div>
  );
}
