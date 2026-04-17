// ProfileBuilder.tsx -- The Profile Builder Screen (Phase 5A Rebuild)
// ====================================================================
// Three-panel layout:
//   Left   -- profile type tabs, list of profiles, create/import buttons
//   Center -- structured form editor with importance-level trait blocks
//   Right  -- Profile Companion chat with 4 behavior modes
//
// Data flow:
//   1. On mount / type change: fetch profile list from backend
//   2. On profile click: fetch full profile, display in editor
//   3. As writer edits: update local state (dirty tracking)
//   4. On Ctrl+S or Save: POST to backend, mark saved
//
// This is a clean rebuild from Phase 4. Key changes:
//   - importance levels replace influence scale (core/present/background/contextual/hidden)
//   - ai_usage_example and notes fields removed from trait blocks
//   - adaptive word count gauge per trait block
//   - 4 behavior modes (chat/extract_traits/check_consistency/refine)
//   - ToolKit removed (replaced by auto-suggest in Phase 5D)

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { Plus, ChevronLeft, ChevronRight, Trash2, Download, Sparkles, Send, Bot, Settings2, ChevronDown, Scissors, HelpCircle, X } from "lucide-react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { ChatMarkdown } from "../components/ChatMarkdown";
import type { ProjectInfo } from "../types/project";
import type {
  Profile,
  ProfileListItem,
  ProfileSection,
  TraitBlock,
  ProfileType,
  ImportanceLevel,
} from "../types/profile";
import type { ProfileChatMessage, ProfileBehaviorMode } from "../types/ai";
import {
  SECTION_CONFIGS,
  PROFILE_TYPE_LABELS,
  IMPORTANCE_LABELS,
} from "../types/profile";
import { v4 as uuidv4 } from "uuid";
import { IMPORTANCE_HELP, getSectionHelp } from "../data/profileHelp";
import type { ImportanceLevelHelp, SectionHelp } from "../data/profileHelp";
import { formatProfileForAI } from "../utils/profileFormat";
import { RightPanelResizer, useRightPanelWidth, RIGHT_PANEL_CLASS } from "../components/RightPanelResizer";

const API_BASE = "http://localhost:8000";


// ── Word Count Gauge ─────────────────────────────────────────────────────────
// Adaptive thresholds shift by importance level. Higher importance = more words
// tolerated, because core traits need more detail for AI to use well.
// Hidden traits have no gauge (writer-only, any length).

interface GaugeThresholds {
  sparse: number;    // 0 to this = sparse (red)
  basic: number;     // to this = basic (amber)
  good: number;      // to this = good (green)
  detailed: number;  // to this = detailed (yellow-green)
  wordy: number;     // to this = wordy (amber)
  // above wordy = bloated (red)
}

const GAUGE_THRESHOLDS: Record<Exclude<ImportanceLevel, "hidden">, GaugeThresholds> = {
  core:       { sparse: 15,  basic: 40,  good: 120, detailed: 200, wordy: 350 },
  present:    { sparse: 10,  basic: 30,  good: 100, detailed: 175, wordy: 300 },
  background: { sparse: 5,   basic: 20,  good: 60,  detailed: 100, wordy: 150 },
  contextual: { sparse: 5,   basic: 15,  good: 40,  detailed: 75,  wordy: 120 },
};

type GaugeLevel = "sparse" | "basic" | "good" | "detailed" | "wordy" | "bloated";

function getGaugeLevel(wordCount: number, importance: ImportanceLevel): { level: GaugeLevel; label: string; color: string } {
  if (importance === "hidden") {
    return { level: "good", label: `${wordCount} words`, color: "text-[#8888aa]" };
  }

  const t = GAUGE_THRESHOLDS[importance];

  if (wordCount <= t.sparse) return { level: "sparse", label: "Sparse -- add more", color: "text-red-400" };
  if (wordCount <= t.basic)  return { level: "basic",  label: "Basic",             color: "text-amber-400" };
  if (wordCount <= t.good)   return { level: "good",   label: "Good",              color: "text-emerald-400" };
  if (wordCount <= t.detailed) return { level: "detailed", label: "Detailed",      color: "text-lime-400" };
  if (wordCount <= t.wordy)  return { level: "wordy",  label: "Wordy -- trim recommended", color: "text-amber-400" };
  return { level: "bloated", label: "Too Bloated!", color: "text-red-400" };
}

// Visual gauge bar that fills proportionally
function WordGauge({ wordCount, importance }: { wordCount: number; importance: ImportanceLevel }) {
  if (importance === "hidden") {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-[#3f3f7a]">
        <span>{wordCount} words (writer-only)</span>
      </div>
    );
  }

  const { level, label, color } = getGaugeLevel(wordCount, importance);
  const t = GAUGE_THRESHOLDS[importance];

  // Calculate fill percentage (0-100), capped at the bloated threshold
  const maxDisplay = t.wordy * 1.3; // gauge bar fills up to 130% of wordy threshold
  const pct = Math.min(100, (wordCount / maxDisplay) * 100);

  // Bar color matches the gauge level
  const barColor =
    level === "sparse"   ? "bg-red-500/60" :
    level === "basic"    ? "bg-amber-500/60" :
    level === "good"     ? "bg-emerald-500/60" :
    level === "detailed" ? "bg-lime-500/50" :
    level === "wordy"    ? "bg-amber-500/60" :
    "bg-red-500/60";

  return (
    <div className="mt-1.5 flex items-center gap-2">
      {/* The gauge bar */}
      <div className="h-1 flex-1 rounded-full bg-[#1e1e4a]">
        <div
          className={`h-1 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Label */}
      <span className={`shrink-0 text-xs ${color}`}>
        {label} ({wordCount})
      </span>
    </div>
  );
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// formatProfileForAI is imported from utils/profileFormat.ts -- single source
// of truth for how profiles are represented in AI prompts. Used here for
// generate-full-summary and the profile chat system.

// ── AutoTextarea ─────────────────────────────────────────────────────────────
// A textarea that auto-expands to fit its content, preventing unnecessary
// scrollbars while keeping a minimum visible height.

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
    el.style.height = "auto";
    const lineH = 20;
    const minH = minRows * lineH + 12;
    el.style.height = Math.max(el.scrollHeight, minH) + "px";
  }, [value, minRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={minRows}
      style={{ resize: "none", overflow: "hidden" }}
      className={className}
    />
  );
}


// ChatMarkdown is now imported from components/ChatMarkdown.tsx (shared with App.tsx)


// ── Props ────────────────────────────────────────────────────────────────────
interface ProfileBuilderProps {
  project: ProjectInfo;
  initialType: ProfileType;
  onBack: () => void;
}


// ── ProfileBuilder Component ─────────────────────────────────────────────────
export function ProfileBuilder({ project, initialType, onBack }: ProfileBuilderProps) {

  // ── State ────────────────────────────────────────────────────────────────
  const [profileType, setProfileType] = useState<ProfileType>(initialType);
  const [profileList, setProfileList] = useState<ProfileListItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create profile form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [creating, setCreating] = useState(false);

  // Refs for Ctrl+S handler (avoids stale closures)
  const profileRef = useRef<Profile | null>(null);
  profileRef.current = profile;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // Generation state -- tracks which field is being AI-generated
  const [generatingField, setGeneratingField] = useState<string | null>(null);

  // Chat state -- session-only, no server persistence
  const [chatMessages, setChatMessages] = useState<ProfileChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Behavior mode (4 modes: chat, extract_traits, check_consistency, refine)
  const [behaviorMode, setBehaviorMode] = useState<ProfileBehaviorMode>("chat");
  const [behaviorPanelOpen, setBehaviorPanelOpen] = useState(false);

  // Importance Audit state -- AI reviews all trait blocks for importance mismatches
  const [auditFlags, setAuditFlags] = useState<{ trait: string; current_importance: string; suggested_importance: string; reason: string }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  // Focused section indicator
  const [focusedSection, setFocusedSection] = useState<{ key: string; heading: string } | null>(null);

  // Right panel collapse
  const [chatCollapsed, setChatCollapsed] = useState(false);

  // Right panel width -- toggleable compact/wide, persisted per localStorage.
  // Separate key from the Writing Companion so the two panels can have
  // independent preferences.
  const chatPanel = useRightPanelWidth("storyforge.profileBuilder.chatWidth");

  // Section configs for the current profile type
  const sections = useMemo(
    () => SECTION_CONFIGS[profileType] ?? [],
    [profileType]
  );

  // Reset chat state when switching profiles
  useEffect(() => {
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setBehaviorMode("chat");
    setBehaviorPanelOpen(false);
    setFocusedSection(null);
  }, [profile?.filename]);


  // ── Data Operations ──────────────────────────────────────────────────────

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
      setProfileList(await res.json());
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
      setProfile(await res.json());
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profile.");
    } finally {
      setEditorLoading(false);
    }
  }, [project.root_path]);

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
      setProfile(await res.json());
      setIsDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    }
  }, [project.root_path]);

  // Ctrl+S keyboard shortcut
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

  const handleImport = async () => {
    setError(null);
    const selected = await openFilePicker({
      multiple: false,
      title: "Select a character profile to import",
      filters: [{ name: "Markdown Profile", extensions: ["md"] }],
    });
    if (!selected || typeof selected !== "string") return;
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
      await fetchProfileList("character");
      setProfile(imported);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import profile.");
    }
  };


  // ── Profile Field Updaters ───────────────────────────────────────────────

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
      importance: "background",
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


  // ── AI Generation Handlers ───────────────────────────────────────────────

  async function generateSectionSummary(sectionKey: string, sectionHeading: string) {
    if (!profile) return;
    setGeneratingField(sectionKey);
    setError(null);

    const section = profile.sections[sectionKey];
    const cfg = sections.find(c => c.key === sectionKey);

    let contentText = "";
    if (cfg?.hasTraitBlocks && section.trait_blocks.length > 0) {
      contentText = section.trait_blocks
        .map(b => `- ${b.trait} [${b.importance}]: ${b.description}`)
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
          profile_name: profile.name,
          profile_type: profile.type,
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

  async function generateFullSummary() {
    if (!profile) return;
    setGeneratingField("full_summary");
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-full-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          profile_content: formatProfileForAI(profile),
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


  // ── Importance Audit Handler ──────────────────────────────────────────────
  // Collects all trait blocks across all sections and sends them to AI for review.

  async function runImportanceAudit() {
    if (!profile) return;
    setAuditLoading(true);
    setAuditOpen(true);
    setAuditFlags([]);

    // Gather every trait block with its section heading
    const allBlocks: { trait: string; description: string; importance: string; section_heading: string }[] = [];
    const sections = SECTION_CONFIGS[profile.type] ?? [];
    for (const cfg of sections) {
      const section = profile.sections[cfg.key];
      if (!section?.trait_blocks) continue;
      for (const block of section.trait_blocks) {
        allBlocks.push({
          trait: block.trait,
          description: block.description,
          importance: block.importance,
          section_heading: cfg.heading,
        });
      }
    }

    if (allBlocks.length === 0) {
      setAuditFlags([]);
      setAuditLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/ai/audit-importance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          trait_blocks: allBlocks,
        }),
      });
      if (!res.ok) throw new Error("Audit request failed");
      const data = await res.json();
      setAuditFlags(data.flags ?? []);
    } catch {
      setAuditFlags([{ trait: "Error", current_importance: "", suggested_importance: "", reason: "Audit failed. Check your API key and model settings." }]);
    } finally {
      setAuditLoading(false);
    }
  }


  // ── Chat Handler ─────────────────────────────────────────────────────────

  async function sendChatMessage() {
    if (!profile || !chatInput.trim() || chatLoading) return;

    const userMessage: ProfileChatMessage = { role: "user", content: chatInput.trim() };
    const newMessages = [...chatMessages, userMessage];

    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      // Build context: for now, send full profile content.
      // Phase 5D will add auto-suggested Toolkit context.
      const profileContent = formatProfileForAI(profile);

      const res = await fetch(`${API_BASE}/api/ai/profile-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          profile_content: profileContent,
          messages: newMessages,
          behavior_mode: behaviorMode,
          content_mode: project.content_mode_default ?? "general",
          section_labels: sections.map(c => c.heading),
          project_path: project.root_path,
        }),
      });

      if (!res.ok) {
        let detail = `Server returned ${res.status}.`;
        try {
          const errBody = await res.json();
          detail = errBody.detail ?? detail;
        } catch {}
        throw new Error(detail);
      }

      const data = await res.json();
      setChatMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setChatError("Request timed out. The model may be overloaded -- try again or switch to a faster model.");
      } else {
        setChatError(err instanceof Error ? err.message : "Chat request failed.");
      }
    } finally {
      clearTimeout(timeoutId);
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }


  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-[#070724] text-[#f0f0f5]">

      {/* ── LEFT PANEL: Type Tabs + Profile List ───────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#1e1e4a] bg-[#0d0d2b]">

        {/* Back button */}
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
                onClick={() => { if (type !== profileType) setProfileType(type); }}
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
              {profileType === "character" && (
                <button
                  onClick={handleImport}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-indigo-300"
                  title="Import a character profile from another project"
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
              No {PROFILE_TYPE_LABELS[profileType].toLowerCase()} yet. Click New to create one.
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
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-[#f0f0f5]">
              {profile ? profile.name : "Profile Builder"}
            </span>
            {profile && (
              <span className="shrink-0 rounded-full border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa]">
                {PROFILE_TYPE_LABELS[profile.type as ProfileType] ?? profile.type}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
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

        {/* Create profile form */}
        {showCreateForm && (
          <div className="shrink-0 border-b border-[#1e1e4a] bg-[#0d0d2b] px-4 py-4">
            <p className="mb-3 text-sm font-semibold text-[#f0f0f5]">
              New {PROFILE_TYPE_LABELS[profileType].slice(0, -1)}
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

              {/* Importance Audit button + results */}
              {sections.some(s => s.hasTraitBlocks) && (
                <div className="mb-6">
                  <button
                    onClick={runImportanceAudit}
                    disabled={auditLoading}
                    className="flex items-center gap-1.5 rounded border border-teal-700/50 px-3 py-1.5 text-xs text-teal-400 transition-colors hover:border-teal-500 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI reviews all traits and flags importance level mismatches"
                  >
                    <Sparkles size={11} />
                    {auditLoading ? "Auditing..." : "Audit Importance Levels"}
                  </button>

                  {auditOpen && (
                    <div className="mt-3 rounded border border-teal-800/40 bg-teal-950/20 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-teal-300">Importance Audit Results</p>
                        <button
                          onClick={() => setAuditOpen(false)}
                          className="text-xs text-teal-700 hover:text-teal-400"
                        >
                          Close
                        </button>
                      </div>
                      {auditLoading ? (
                        <p className="text-xs text-teal-600 animate-pulse">Analyzing trait blocks...</p>
                      ) : auditFlags.length === 0 ? (
                        <p className="text-xs text-teal-500">All importance levels look reasonable. No mismatches found.</p>
                      ) : (
                        <div className="space-y-2">
                          {auditFlags.map((flag, i) => (
                            <div key={i} className="rounded border border-teal-800/30 bg-[#0d0d2b] p-2">
                              <div className="mb-1 flex items-center gap-2 text-xs">
                                <span className="font-medium text-teal-200">{flag.trait}</span>
                                {flag.current_importance && flag.suggested_importance && (
                                  <span className="text-teal-600">
                                    {flag.current_importance} → {flag.suggested_importance}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs leading-relaxed text-teal-400/80">{flag.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                    profileName={profile.name}
                    profileType={profile.type}
                    onContentChange={content => updateSection(cfg.key, { content })}
                    onAiSummaryChange={ai_summary => updateSection(cfg.key, { ai_summary })}
                    onAddTraitBlock={() => addTraitBlock(cfg.key)}
                    onUpdateTraitBlock={(id, updates) => updateTraitBlock(cfg.key, id, updates)}
                    onRemoveTraitBlock={id => removeTraitBlock(cfg.key, id)}
                    onGenerateSectionSummary={() => generateSectionSummary(cfg.key, cfg.heading)}
                    generatingField={generatingField}
                    onFocus={() => setFocusedSection({ key: cfg.key, heading: cfg.heading })}
                  />
                );
              })}

              {/* Full AI Summary -- teal card */}
              <div className="mb-6 rounded border border-teal-800/40 bg-teal-950/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-teal-200">
                      {profile.type === "chapter_summary"
                        ? "Chapter Summary"
                        : profile.type === "scene_summary"
                        ? "Scene Summary"
                        : "Full AI Summary"}
                    </h2>
                    <p className="mt-0.5 text-xs text-teal-700">
                      {profile.type === "chapter_summary" || profile.type === "scene_summary"
                        ? "Used as AI context when attached as a context chip in the editor."
                        : "Attached as a context chip in the editor. Generate after filling in the sections above."}
                    </p>
                  </div>
                  <button
                    onClick={generateFullSummary}
                    disabled={generatingField === "full_summary"}
                    className="flex shrink-0 items-center gap-1 rounded border border-teal-700/50 px-2 py-0.5 text-xs text-teal-400 transition-colors hover:border-teal-500 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Generate this summary using AI based on the profile content above"
                  >
                    <Sparkles size={11} />
                    {generatingField === "full_summary" ? "Generating..." : "Generate"}
                  </button>
                </div>
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
                  className="w-full rounded border border-teal-800/40 bg-[#0a1a1a] px-3 py-2 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-teal-600"
                  minRows={4}
                />
              </div>

            </div>
          )}
        </div>
      </main>


      {/* ── RIGHT PANEL: Profile Companion Chat ────────────────────────
          Two size modes. Collapsed -> a 40px strip. Expanded -> either the
          compact or wide width chosen by the resizer. The resizer button
          cluster is only rendered when the panel is expanded; its anchor
          (`relative`) applies in both states but the absolute children are
          hidden when collapsed. */}
      <aside className={`relative flex shrink-0 flex-col border-l border-[#1e1e4a] bg-[#0d0d2b] transition-all duration-200 ${chatCollapsed ? "w-10" : RIGHT_PANEL_CLASS[chatPanel.width]}`}>

        {!chatCollapsed && (
          <RightPanelResizer width={chatPanel.width} setWidth={chatPanel.setWidth} />
        )}

        {/* Collapsed view */}
        {chatCollapsed ? (
          <button
            onClick={() => setChatCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#3f3f7a] transition-colors hover:bg-[#12122e] hover:text-[#8888aa]"
            title="Expand the Profile Chat panel"
          >
            <span className="text-xs font-medium" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              Profile Chat
            </span>
          </button>
        ) : (
        <>

        {/* Chat header */}
        <div className="border-b border-[#1e1e4a] px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="shrink-0 text-sm font-semibold text-[#f0f0f5]">Profile Chat</h2>
              {focusedSection && (
                <span
                  className="truncate rounded-full border border-indigo-800/50 bg-indigo-900/20 px-2 py-0.5 text-xs text-indigo-400"
                  title={`Writer is focused on the "${focusedSection.heading}" section`}
                >
                  {focusedSection.heading}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {chatMessages.length > 0 && (
                <button
                  onClick={() => { setChatMessages([]); setChatError(null); }}
                  className="text-xs text-rose-700 transition-colors hover:text-rose-400"
                  title="Clear the conversation"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setChatCollapsed(true)}
                className="rounded p-0.5 text-[#3f3f7a] transition-colors hover:bg-[#12122e] hover:text-[#8888aa]"
                title="Collapse the chat panel"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-[#8888aa]">
            Session-only. Pick a mode below, then ask your question.
          </p>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {!profile && (
            <p className="text-center text-xs text-[#3f3f7a]">Open a profile to start chatting.</p>
          )}

          {profile && chatMessages.length === 0 && (
            <div className="flex flex-col items-center gap-3 pt-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-900/40 text-indigo-400">
                <Bot size={20} />
              </div>
              <div>
                <p className="text-sm font-medium text-[#8888aa]">Profile Companion</p>
                <p className="mt-1 text-xs text-[#3f3f7a]">
                  Pick a behavior mode below and type your question.
                </p>
              </div>
              <div className="w-full rounded border border-[#1e1e4a] bg-[#070724] p-2.5 text-left">
                <p className="mb-1 text-xs font-medium text-[#8888aa]">Try asking:</p>
                {[
                  "How would AI use the core traits?",
                  "What's missing from this profile?",
                  "How does her voice trait affect dialogue?",
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => setChatInput(q)}
                    className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-[#3f3f7a] transition-colors hover:bg-[#1e1e4a] hover:text-[#8888aa]"
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="mr-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-900/60 text-indigo-400">
                  <Bot size={11} />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm bg-indigo-600 text-white"
                    : "rounded-tl-sm border border-[#1e1e4a] bg-[#12122e] text-[#f0f0f5]"
                }`}
              >
                {msg.role === "user" ? (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  <ChatMarkdown content={msg.content} />
                )}
              </div>

              {msg.role === "user" && (
                <div className="ml-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-800/60 text-indigo-300">
                  <span className="text-xs font-bold">W</span>
                </div>
              )}
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

          <div ref={chatEndRef} />
        </div>

        {/* Behavior mode selector */}
        <AiBehaviorPanel
          currentMode={behaviorMode}
          open={behaviorPanelOpen}
          onToggleOpen={() => setBehaviorPanelOpen(o => !o)}
          onSelectMode={(mode) => {
            setBehaviorMode(mode);
            setBehaviorPanelOpen(false);
            setChatMessages([]);
            setChatError(null);
          }}
        />

        {/* Chat input */}
        <div className="border-t border-[#1e1e4a] p-3">
          <div className="relative flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                const maxH = 7 * 20 + 12;
                el.style.height = Math.min(el.scrollHeight, maxH) + "px";
                el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder={
                profile
                  ? "Ask about this profile... (Enter to send)"
                  : "Open a profile first"
              }
              disabled={!profile || chatLoading}
              rows={3}
              style={{ resize: "none", overflowY: "hidden" }}
              className={`flex-1 rounded border px-2 py-2 text-xs text-[#f0f0f5] placeholder-[#6666a0] outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50 bg-[#1e1e48] ${
                chatInput.length > 6000
                  ? "border-red-600"
                  : chatInput.length > 3000
                  ? "border-amber-600"
                  : "border-[#1e1e4a]"
              }`}
            />
            {chatInput.length > 500 && (
              <div className={`absolute bottom-1 right-14 text-xs ${
                chatInput.length > 6000
                  ? "text-red-400"
                  : chatInput.length > 3000
                  ? "text-amber-500"
                  : "text-[#3f3f7a]"
              }`}>
                {chatInput.length.toLocaleString()} chars
                {chatInput.length > 6000 && " -- may be too large"}
              </div>
            )}
            <button
              onClick={sendChatMessage}
              disabled={!profile || !chatInput.trim() || chatLoading}
              className="flex items-center justify-center rounded border border-[#1e1e4a] p-1.5 text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send message (Enter)"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
        </>
        )}
      </aside>

    </div>
  );
}


// ── ProfileSectionEditor ──────────────────────────────────────────────────────
// Renders one section: either a plain textarea or a list of trait block cards,
// followed by an AI summary textarea.

interface ProfileSectionEditorProps {
  sectionKey: string;
  heading: string;
  hasTraitBlocks: boolean;
  section: ProfileSection;
  profileName: string;
  profileType: string;
  onContentChange: (content: string) => void;
  onAiSummaryChange: (ai_summary: string) => void;
  onAddTraitBlock: () => void;
  onUpdateTraitBlock: (id: string, updates: Partial<TraitBlock>) => void;
  onRemoveTraitBlock: (id: string) => void;
  onGenerateSectionSummary: () => void;
  generatingField: string | null;
  onFocus: () => void;
}

function ProfileSectionEditor({
  sectionKey,
  heading,
  hasTraitBlocks,
  section,
  profileName,
  profileType,
  onContentChange,
  onAiSummaryChange,
  onAddTraitBlock,
  onUpdateTraitBlock,
  onRemoveTraitBlock,
  onGenerateSectionSummary,
  generatingField,
  onFocus,
}: ProfileSectionEditorProps) {
  const isGeneratingSummary = generatingField === sectionKey;

  return (
    <div className="mb-6" onFocus={onFocus}>
      {/* Section heading with indigo accent + help icon for text sections */}
      <div className="mb-3 flex items-center gap-2.5 border-b border-[#1e1e4a] pb-2">
        <span className="h-4 w-0.5 shrink-0 rounded-full bg-indigo-600/70" />
        <h2 className="text-sm font-semibold text-[#f0f0f5]">{heading}</h2>
        {/* (?) icon -- shows writing tips with Poor/Good/Great examples.
            Only renders if help content exists for this section. */}
        {!hasTraitBlocks && (
          <SectionHelpPopover profileType={profileType} sectionKey={sectionKey} />
        )}
      </div>

      {hasTraitBlocks ? (
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
              profileName={profileName}
              profileType={profileType}
              sectionKey={sectionKey}
              sectionHeading={heading}
              onUpdate={updates => onUpdateTraitBlock(block.id, updates)}
              onRemove={() => onRemoveTraitBlock(block.id)}
            />
          ))}
          <button
            onClick={onAddTraitBlock}
            className="mb-3 flex items-center gap-1 rounded border border-dashed border-[#1e1e4a] px-3 py-1.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300"
            title="Add a trait or group of related traits"
          >
            <Plus size={12} /> Add Trait
          </button>
        </div>
      ) : (
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


// ── ImportanceHelpPopover ─────────────────────────────────────────────────────
// Clickable (?) icon next to the importance dropdown in TraitBlockCard.
// Shows a short summary of what the current importance level does, then a
// detailed explanation with a section-specific example so the writer can see
// how importance applies differently for Physical Traits vs Voice Notes, etc.
//
// Uses a toggle pattern: click (?) to open, click X or the icon again to close.

function ImportanceHelpPopover({
  importance,
  sectionKey,
}: {
  importance: ImportanceLevel;
  sectionKey: string;
}) {
  const [open, setOpen] = useState(false);
  const help: ImportanceLevelHelp | undefined = IMPORTANCE_HELP[importance];

  if (!help) return null;

  // Find the best example for this section. Fall back to the first available
  // example if the section key doesn't have one (e.g. a future section type).
  const example =
    help.examples[sectionKey] ??
    Object.values(help.examples)[0] ??
    "";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="shrink-0 rounded p-0.5 text-[#3f3f7a] transition-colors hover:text-indigo-400"
        title={`Help: ${importance} importance level`}
      >
        <HelpCircle size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-30 w-72 rounded-lg border border-[#1e1e4a] bg-[#0a0a20] p-3 shadow-xl">
          {/* Header */}
          <div className="mb-2 flex items-start justify-between">
            <p className="text-xs font-semibold text-indigo-300">
              {importance.charAt(0).toUpperCase() + importance.slice(1)} Importance
            </p>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-[#3f3f7a] hover:text-[#f0f0f5]"
            >
              <X size={10} />
            </button>
          </div>

          {/* Summary */}
          <p className="mb-2 text-xs font-medium text-[#f0f0f5]">{help.summary}</p>

          {/* Detail */}
          <p className="mb-3 text-xs leading-relaxed text-[#8888aa]">{help.detail}</p>

          {/* Section-specific example */}
          {example && (
            <div className="rounded border border-[#1e1e4a] bg-[#12122e] p-2">
              <p className="mb-1 text-xs font-medium text-[#8888aa]">Example for this section:</p>
              <p className="whitespace-pre-line text-xs leading-relaxed text-[#c0c0d0]">{example}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── SectionHelpPopover ───────────────────────────────────────────────────────
// Clickable (?) icon next to text section headings (Overview, Notes, etc.).
// Shows what the writer should put in the field, plus Poor / Good / Great
// example tiers so they can see the spectrum from "AI will struggle" to
// "AI will nail this."

function SectionHelpPopover({
  profileType,
  sectionKey,
}: {
  profileType: string;
  sectionKey: string;
}) {
  const [open, setOpen] = useState(false);
  const help: SectionHelp | null = getSectionHelp(profileType, sectionKey);

  // No help content for this section -- don't render the icon at all.
  // This keeps the UI clean for sections we haven't written help for yet.
  if (!help) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="shrink-0 rounded p-0.5 text-[#3f3f7a] transition-colors hover:text-indigo-400"
        title="Writing tips for this section"
      >
        <HelpCircle size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-30 max-h-[28rem] w-80 overflow-y-auto rounded-lg border border-[#1e1e4a] bg-[#0a0a20] p-3 shadow-xl">
          {/* Header */}
          <div className="mb-2 flex items-start justify-between">
            <p className="text-xs font-semibold text-indigo-300">Writing Tips</p>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-[#3f3f7a] hover:text-[#f0f0f5]"
            >
              <X size={10} />
            </button>
          </div>

          {/* What to put */}
          <p className="mb-3 text-xs leading-relaxed text-[#f0f0f5]">{help.whatToPut}</p>

          {/* Poor example */}
          <div className="mb-2 rounded border border-red-900/40 bg-red-950/20 p-2">
            <p className="mb-1 text-xs font-medium text-red-400">Needs Work</p>
            <p className="mb-1 text-xs italic text-red-300/70">"{help.poorExample}"</p>
            <p className="text-xs text-red-400/60">{help.poorWhy}</p>
          </div>

          {/* Good example */}
          <div className="mb-2 rounded border border-amber-800/40 bg-amber-950/20 p-2">
            <p className="mb-1 text-xs font-medium text-amber-400">Good</p>
            <p className="mb-1 text-xs italic text-amber-200/70">"{help.goodExample}"</p>
            <p className="text-xs text-amber-400/60">{help.goodWhy}</p>
          </div>

          {/* Great example */}
          <div className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2">
            <p className="mb-1 text-xs font-medium text-emerald-400">Great</p>
            <p className="mb-1 text-xs italic text-emerald-200/70">"{help.greatExample}"</p>
            <p className="text-xs text-emerald-400/60">{help.greatWhy}</p>
          </div>
        </div>
      )}
    </div>
  );
}


// ── TraitBlockCard ────────────────────────────────────────────────────────────
// Renders one trait block with importance selector, trait name, description
// textarea, and adaptive word count gauge.

interface TraitBlockCardProps {
  block: TraitBlock;
  profileName: string;
  profileType: string;
  sectionKey: string;
  sectionHeading: string;
  onUpdate: (updates: Partial<TraitBlock>) => void;
  onRemove: () => void;
}

function TraitBlockCard({ block, profileName, profileType, sectionKey, sectionHeading, onUpdate, onRemove }: TraitBlockCardProps) {
  const wordCount = countWords(block.description);

  // AI Trim tool -- suggests a concise rewrite when description is wordy/bloated
  const [trimText, setTrimText] = useState("");
  const [trimLoading, setTrimLoading] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);

  const gaugeInfo = getGaugeLevel(wordCount, block.importance);
  const showTrimButton = gaugeInfo.level === "wordy" || gaugeInfo.level === "bloated";

  const generateTrim = async () => {
    if (!block.trait.trim() || !block.description.trim()) return;
    setTrimLoading(true);
    setTrimOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/trim-trait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profileName,
          profile_type: profileType,
          section_heading: sectionHeading,
          trait: block.trait,
          description: block.description,
          importance: block.importance,
          word_count: wordCount,
        }),
      });
      if (!res.ok) throw new Error("Trim request failed");
      const data = await res.json();
      setTrimText(data.trimmed ?? "");
    } catch {
      setTrimText("Failed to generate trim suggestion. Check your API key and model settings.");
    } finally {
      setTrimLoading(false);
    }
  };

  // "How AI uses this" preview -- on-demand AI explanation of this trait's importance
  const [previewText, setPreviewText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const generatePreview = async () => {
    if (!block.trait.trim() || !block.description.trim()) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-usage-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profileName,
          profile_type: profileType,
          section_heading: sectionHeading,
          trait: block.trait,
          description: block.description,
          importance: block.importance,
        }),
      });
      if (!res.ok) throw new Error("Preview generation failed");
      const data = await res.json();
      setPreviewText(data.usage_preview ?? "");
    } catch {
      setPreviewText("Failed to generate preview. Check your API key and model settings.");
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="mb-3 rounded border border-[#1e1e4a] bg-[#0d0d2b] p-3">
      {/* Top row: importance selector + trait name + delete button */}
      <div className="mb-2 flex items-start gap-2">
        {/* Importance dropdown */}
        <select
          value={block.importance}
          onChange={e => onUpdate({ importance: e.target.value as ImportanceLevel })}
          className="shrink-0 rounded border border-[#1e1e4a] bg-[#12122e] px-1.5 py-1 text-xs text-[#f0f0f5] outline-none focus:border-indigo-500"
          title="How prominently AI uses this trait"
        >
          {(Object.keys(IMPORTANCE_LABELS) as ImportanceLevel[]).map(level => (
            <option key={level} value={level}>
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </option>
          ))}
        </select>

        {/* (?) help icon -- explains this importance level with section-specific examples */}
        <ImportanceHelpPopover importance={block.importance} sectionKey={sectionKey} />

        {/* Trait name */}
        <input
          type="text"
          value={block.trait}
          onChange={e => onUpdate({ trait: e.target.value })}
          placeholder="Trait name (e.g. observant, punctual)"
          className="min-w-0 flex-1 rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
        />

        {/* "How AI uses this" button -- generates on-demand prose explanation */}
        <button
          onClick={generatePreview}
          disabled={previewLoading || !block.trait.trim() || !block.description.trim()}
          className="shrink-0 rounded p-1 text-[#3f3f7a] transition-colors hover:text-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          title="How AI uses this trait (generates a preview explanation)"
        >
          <Sparkles size={12} />
        </button>

        {/* Delete button */}
        <button
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-[#3f3f7a] transition-colors hover:bg-red-950/40 hover:text-red-400"
          title="Remove this trait"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Description textarea */}
      <textarea
        value={block.description}
        onChange={e => onUpdate({ description: e.target.value })}
        placeholder="Describe this trait in detail. Be specific to this character."
        rows={3}
        className="mb-1 w-full resize-y rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5 text-sm text-[#f0f0f5] placeholder-[#3f3f7a] outline-none focus:border-indigo-500"
      />

      {/* Word count gauge + trim button when wordy/bloated */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <WordGauge wordCount={wordCount} importance={block.importance} />
        </div>
        {showTrimButton && (
          <button
            onClick={generateTrim}
            disabled={trimLoading}
            className="mt-1 flex shrink-0 items-center gap-1 rounded border border-amber-700/50 px-1.5 py-0.5 text-xs text-amber-400 transition-colors hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            title="AI suggests a more concise version of this description"
          >
            <Scissors size={10} />
            {trimLoading ? "Trimming..." : "Trim"}
          </button>
        )}
      </div>

      {/* AI Trim suggestion -- expandable area */}
      {trimOpen && (
        <div className="mt-2 rounded border border-amber-800/40 bg-amber-950/20 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium text-amber-400">Trim Suggestion</p>
            <button
              onClick={() => setTrimOpen(false)}
              className="text-xs text-amber-700 hover:text-amber-400"
            >
              Close
            </button>
          </div>
          {trimLoading ? (
            <p className="text-xs text-amber-600 animate-pulse">Generating trim...</p>
          ) : (
            <>
              <p className="mb-2 text-xs leading-relaxed text-amber-200/80">{trimText}</p>
              <button
                onClick={() => {
                  onUpdate({ description: trimText });
                  setTrimOpen(false);
                }}
                className="rounded border border-amber-700/50 px-2 py-0.5 text-xs text-amber-300 transition-colors hover:border-amber-500 hover:bg-amber-900/30 hover:text-amber-100"
                title="Replace the current description with this trimmed version"
              >
                Apply
              </button>
            </>
          )}
        </div>
      )}

      {/* "How AI uses this" preview -- expandable area below gauge */}
      {previewOpen && (
        <div className="mt-2 rounded border border-indigo-800/40 bg-indigo-950/20 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium text-indigo-400">How AI uses this</p>
            <button
              onClick={() => setPreviewOpen(false)}
              className="text-xs text-indigo-700 hover:text-indigo-400"
            >
              Close
            </button>
          </div>
          {previewLoading ? (
            <p className="text-xs text-indigo-600 animate-pulse">Generating preview...</p>
          ) : (
            <p className="text-xs leading-relaxed text-indigo-200/80">{previewText}</p>
          )}
        </div>
      )}
    </div>
  );
}


// ── AiBehaviorPanel ──────────────────────────────────────────────────────────
// Four simplified behavior modes for the Profile Companion.

const BEHAVIOR_MODES: { id: ProfileBehaviorMode; label: string; description: string }[] = [
  {
    id: "chat",
    label: "Chat",
    description: "Open conversation about this profile. Ask anything.",
  },
  {
    id: "refine",
    label: "Refine",
    description: "Sharpen traits, interpret how AI uses them, or get a summary of the profile.",
  },
  {
    id: "extract_traits",
    label: "Extract Traits",
    description: "Paste text and name a character. AI extracts traits organized by category.",
  },
  {
    id: "check_consistency",
    label: "Check Consistency",
    description: "Flags contradictions, overlaps, and importance level mismatches.",
  },
];

interface AiBehaviorPanelProps {
  currentMode: ProfileBehaviorMode;
  open: boolean;
  onToggleOpen: () => void;
  onSelectMode: (mode: ProfileBehaviorMode) => void;
}

function AiBehaviorPanel({ currentMode, open, onToggleOpen, onSelectMode }: AiBehaviorPanelProps) {
  const current = BEHAVIOR_MODES.find(m => m.id === currentMode) ?? BEHAVIOR_MODES[0];

  return (
    <div className="border-b border-teal-800/40 bg-teal-950/40">

      {/* Expanded mode list */}
      {open && (
        <div className="border-b border-teal-800/30 px-2 pb-2 pt-1.5">
          <p className="mb-2 px-1 text-xs text-teal-600">
            Choose what the AI should do. Switching mode clears the conversation.
          </p>
          {BEHAVIOR_MODES.map(mode => {
            const isActive = mode.id === currentMode;
            return (
              <button
                key={mode.id}
                onClick={() => onSelectMode(mode.id)}
                className={`mb-1 w-full rounded px-2 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-teal-700/30 text-teal-100"
                    : "text-teal-400 hover:bg-teal-900/30 hover:text-teal-200"
                }`}
              >
                <p className="text-xs font-medium">{mode.label}</p>
                <p className="mt-0.5 text-xs text-teal-600">{mode.description}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Toggle bar */}
      <button
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-teal-900/20"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 size={12} className="shrink-0 text-teal-600" />
          <span className="text-xs text-teal-500">Mode:</span>
          <span className="truncate text-xs font-medium text-teal-300">
            {current.label}
          </span>
        </div>
        <ChevronDown
          size={12}
          className={`shrink-0 text-teal-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  );
}
