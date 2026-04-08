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

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { Plus, ChevronLeft, Trash2, Download, Sparkles, Send, Bot, Settings2, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
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


// ── ToolKit Types ─────────────────────────────────────────────────────────────
// A ToolkitItem is one selectable row in the ToolKit panel.
// A ToolkitSection groups related items under a section header checkbox.

interface ToolkitItem {
  id: string;           // Unique key for selection tracking
  sectionKey: string;   // Which profile section this belongs to
  label: string;        // Primary display line (trait name, section heading, etc.)
  sub: string;          // Secondary display line (start of description)
  content: string;      // Full text to include in AI context when selected
}

interface ToolkitSection {
  key: string;          // Matches the profile section key (e.g. "physical_traits")
  label: string;        // Human-readable section name (e.g. "Physical Traits")
  items: ToolkitItem[];
}


// ── ToolKit Helper Functions ──────────────────────────────────────────────────
// These are module-level (outside the React component) because they are pure
// functions that don't need component state -- they just transform data.

const SUMMARY_PLACEHOLDER = "_Generated on demand. Editable by writer._";

/**
 * Extract readable plain text from an AI summary field.
 * AI summaries are sometimes stored with a JSON code block wrapper:
 *   ```json
 *   {"section_summary": "actual text here"}
 *   ```
 * This strips the wrapper and returns just the readable text.
 * If the content is not JSON-wrapped, it's returned as-is.
 */
function extractSummaryText(raw: string): string {
  if (!raw.trim()) return "";

  // Try extracting from ```json { "key": "value" } ``` fenced block
  const fenceMatch = raw.match(
    /```(?:json)?\s*\{[\s\S]*?"(?:section_summary|full_summary|ai_usage_example)":\s*"([\s\S]*?)"\s*\}\s*```/
  );
  if (fenceMatch) {
    return fenceMatch[1]
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"')
      .trim();
  }

  // Try parsing as raw JSON (no fences)
  try {
    const str = raw.trim();
    if (str.startsWith("{")) {
      const parsed = JSON.parse(str);
      for (const key of ["section_summary", "full_summary", "ai_usage_example"]) {
        if (typeof parsed[key] === "string") return parsed[key].trim();
      }
    }
  } catch {}

  // Not JSON -- return as-is (plain text summaries written by the writer)
  return raw.trim();
}

/**
 * Format one trait block into a readable text string for AI context.
 * Includes all filled fields (influence, description, usage example, notes).
 */
function formatTraitForContext(block: TraitBlock, sectionHeading: string): string {
  const lines = [`${sectionHeading} Trait: ${block.trait}`];
  if (block.influence) lines.push(`Influence: ${block.influence}`);
  if (block.description.trim()) lines.push(`Description: ${block.description.trim()}`);
  if (block.ai_usage_example.trim()) lines.push(`AI Usage Hint: ${block.ai_usage_example.trim()}`);
  if (block.notes.trim()) lines.push(`Notes: ${block.notes.trim()}`);
  return lines.join("\n");
}

/**
 * Build the list of selectable ToolkitSections from the current profile.
 * Only includes sections and traits that actually have content.
 * AI summaries are included if they have been generated (not just placeholders).
 */
function buildToolkitSections(profile: Profile): ToolkitSection[] {
  const configs = SECTION_CONFIGS[profile.type as ProfileType] ?? [];
  const result: ToolkitSection[] = [];

  for (const cfg of configs) {
    const section = profile.sections[cfg.key];
    if (!section) continue;

    const items: ToolkitItem[] = [];

    if (cfg.hasTraitBlocks) {
      // Trait-block sections: one item per trait
      for (const block of section.trait_blocks) {
        if (!block.trait.trim() && !block.description.trim()) continue;
        items.push({
          id: `trait:${cfg.key}:${block.id}`,
          sectionKey: cfg.key,
          label: block.trait || "(untitled)",
          sub: block.description,
          content: formatTraitForContext(block, cfg.heading),
        });
      }
    } else {
      // Plain-text sections: one item for the whole section.
      // Label shows the START of the content, not the heading again
      // (showing the heading twice -- as section header AND item label -- is confusing).
      if (section.content.trim()) {
        const text = section.content.trim();
        const preview = text.slice(0, 55) + (text.length > 55 ? "..." : "");
        items.push({
          id: `section:${cfg.key}`,
          sectionKey: cfg.key,
          label: preview,   // First words of actual content -- not the heading
          sub: "",          // No sub needed -- the label already shows the content
          content: `${cfg.heading}:\n${text}`,
        });
      }
    }

    // Add the section's AI summary if it has been generated.
    // Strip any JSON code block wrapper so the display shows readable text,
    // and the content sent to AI is clean plain text too.
    const rawSummary = section.ai_summary.trim();
    if (rawSummary && rawSummary !== SUMMARY_PLACEHOLDER) {
      const cleanSummary = extractSummaryText(rawSummary);
      items.push({
        id: `ai-summary:${cfg.key}`,
        sectionKey: cfg.key,
        label: `AI Summary: ${cfg.heading}`,
        sub: cleanSummary,
        content: `AI Summary -- ${cfg.heading}:\n${cleanSummary}`,
      });
    }

    if (items.length > 0) {
      result.push({ key: cfg.key, label: cfg.heading, items });
    }
  }

  // Full AI Summary as its own section at the bottom.
  // Extract clean text from any JSON wrapper before displaying or sending.
  const rawFull = profile.full_ai_summary.trim();
  if (rawFull && rawFull !== SUMMARY_PLACEHOLDER) {
    const cleanFull = extractSummaryText(rawFull);
    const preview = cleanFull.slice(0, 55) + (cleanFull.length > 55 ? "..." : "");
    result.push({
      key: "full_ai_summary",
      label: "Full AI Summary",
      items: [{
        id: "full-ai-summary",
        sectionKey: "full_ai_summary",
        label: preview,
        sub: "",
        content: `Full AI Summary:\n${cleanFull}`,
      }],
    });
  }

  return result;
}

/**
 * Format the selected context items into a single string to send to the AI.
 *
 * Default behavior (nothing selected):
 *   Name + Role + Overview (if filled)
 *
 * With selections:
 *   Name + Role + only the selected items (in section order)
 *   Overview is NOT included unless explicitly selected.
 */
function formatSelectedContext(
  profile: Profile,
  toolkitSections: ToolkitSection[],
  selections: Set<string>
): string {
  const header = [
    `Character: ${profile.name}`,
    profile.role ? `Role: ${profile.role}` : null,
  ].filter(Boolean).join("\n");

  if (selections.size === 0) {
    // Default: include Overview if it has content
    const overview = profile.sections["overview"];
    if (overview?.content.trim()) {
      return `${header}\n\nOverview:\n${overview.content.trim()}`;
    }
    return header;
  }

  // Send only selected items, preserving section order
  const parts: string[] = [header];
  for (const section of toolkitSections) {
    const selected = section.items.filter(item => selections.has(item.id));
    if (selected.length === 0) continue;
    for (const item of selected) {
      parts.push(item.content);
    }
  }

  return parts.join("\n\n");
}


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

  // --- AI Behavior mode ---
  // Controls which system prompt the backend uses for the chat.
  // "general" = open-ended conversation (default)
  // "interpret_profile" = AI reads selected context and explains how AI tools would use it
  // More modes added over time via the AiBehavior panel.
  const [behaviorMode, setBehaviorMode] = useState("general");
  const [behaviorPanelOpen, setBehaviorPanelOpen] = useState(false);

  // --- ToolKit state ---
  const [toolkitOpen, setToolkitOpen]             = useState(false);
  const [toolkitSelections, setToolkitSelections] = useState<Set<string>>(new Set());

  // Rebuild the ToolKit section list whenever the profile changes.
  // useMemo prevents rebuilding on every render -- only runs when profile changes.
  const toolkitSections = useMemo(
    () => profile ? buildToolkitSections(profile) : [],
    [profile]
  );

  // Toggle one individual item
  const handleToolkitToggleItem = useCallback((id: string) => {
    setToolkitSelections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Toggle a whole section: all selected → deselect all; else → select all
  const handleToolkitToggleSection = useCallback((sectionKey: string, sections: ToolkitSection[]) => {
    setToolkitSelections(prev => {
      const section = sections.find(s => s.key === sectionKey);
      if (!section) return prev;
      const allSelected = section.items.every(item => prev.has(item.id));
      const next = new Set(prev);
      if (allSelected) {
        section.items.forEach(item => next.delete(item.id));
      } else {
        section.items.forEach(item => next.add(item.id));
      }
      return next;
    });
  }, []);

  // Clear all selections → reverts to default Overview behavior
  const handleToolkitClearAll = useCallback(() => setToolkitSelections(new Set()), []);

  // Reset chat, behavior mode, and toolkit when switching profiles
  useEffect(() => {
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setBehaviorMode("general");
    setBehaviorPanelOpen(false);
    setToolkitOpen(false);
    setToolkitSelections(new Set());
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


  // --- Send a chat message ---
  // Packages the writer's message with the current behavior mode and ToolKit context,
  // sends it to the backend, and appends the AI reply to the chat history.
  async function sendChatMessage() {
    if (!profile || !chatInput.trim() || chatLoading) return;

    const userMessage: ProfileChatMessage = { role: "user", content: chatInput.trim() };
    const newMessages = [...chatMessages, userMessage];

    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const res = await fetch(`${API_BASE}/api/ai/profile-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name:    profile.name,
          profile_type:    profile.type,
          // ToolKit selection always controls what context gets sent.
          // The behavior mode controls HOW the AI responds to that context.
          profile_content: formatSelectedContext(profile, toolkitSections, toolkitSelections),
          messages:        newMessages,
          behavior_mode:   behaviorMode,
          content_mode:    project.content_mode_default ?? "general",
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
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-[#1e1e4a] bg-[#0d0d2b]">

        <div className="border-b border-[#1e1e4a] px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#f0f0f5]">Profile Chat</h2>
            {chatMessages.length > 0 && (
              <button
                onClick={() => { setChatMessages([]); setChatError(null); }}
                className="text-xs text-rose-700 transition-colors hover:text-rose-400"
                title="Clear the conversation history and start fresh"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-[#8888aa]">
            Session-only. Use ToolKit to select context and AI Behavior to set the mode.
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
                <p className="text-sm font-medium text-[#8888aa]">Profile Chat</p>
                <p className="mt-1 text-xs text-[#3f3f7a]">
                  Select context in ToolKit, pick a mode in AI Behavior, then type your question.
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
                    onClick={() => { setChatInput(q); }}
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
              {/* AI avatar dot -- shown on the left for AI messages */}
              {msg.role === "assistant" && (
                <div className="mr-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-900/60 text-indigo-400">
                  <Bot size={11} />
                </div>
              )}

              {/* Message bubble -- AI messages are rendered as markdown, writer messages are plain */}
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm bg-indigo-600 text-white"
                    : "rounded-tl-sm border border-[#1e1e4a] bg-[#12122e] text-[#f0f0f5]"
                }`}
              >
                {msg.role === "user" ? (
                  // Writer messages: plain text, no rendering needed
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  // AI messages: render markdown for bold, lists, blockquotes, etc.
                  // Components are customized to match the dark theme and chat context.
                  <ChatMarkdown content={msg.content} />
                )}
              </div>

              {/* Writer avatar dot -- shown on the right for user messages */}
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

          {/* Invisible element used to scroll to the bottom */}
          <div ref={chatEndRef} />
        </div>

        {/* AI Behavior -- selects the AI's intent mode for this conversation */}
        <AiBehaviorPanel
          currentMode={behaviorMode}
          open={behaviorPanelOpen}
          onToggleOpen={() => { setBehaviorPanelOpen(o => !o); setToolkitOpen(false); }}
          onSelectMode={(mode) => {
            setBehaviorMode(mode);
            setBehaviorPanelOpen(false);
            // Clear chat when switching modes -- new mode = fresh context
            setChatMessages([]);
            setChatError(null);
          }}
        />

        {/* ToolKit -- context selection (always shown, applies to all modes) */}
        <ToolKit
          profile={profile}
          toolkitSections={toolkitSections}
          selections={toolkitSelections}
          open={toolkitOpen}
          onToggleOpen={() => { setToolkitOpen(o => !o); setBehaviorPanelOpen(false); }}
          onToggleItem={handleToolkitToggleItem}
          onToggleSection={(key) => handleToolkitToggleSection(key, toolkitSections)}
          onClearAll={handleToolkitClearAll}
        />

        {/* Chat input */}
        <div className="border-t border-[#1e1e4a] p-3">
          {/* items-end aligns the Send button to the bottom of the textarea */}
          <div className="flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                // Auto-expand up to 7 lines then scroll.
                // Each line is ~20px; add 12px for top/bottom padding.
                const el = e.target;
                el.style.height = "auto";
                const maxH = 7 * 20 + 12;
                el.style.height = Math.min(el.scrollHeight, maxH) + "px";
                el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
              }}
              onKeyDown={e => {
                // Enter sends, Shift+Enter inserts a line break
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder={
                profile
                  ? "Ask about this profile... (Enter to send, Shift+Enter for new line)"
                  : "Open a profile first"
              }
              disabled={!profile || chatLoading}
              rows={3}
              style={{ resize: "none", overflowY: "hidden" }}
              className="flex-1 rounded border border-[#1e1e4a] bg-[#1e1e48] px-2 py-2 text-xs text-[#f0f0f5] placeholder-[#6666a0] outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
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


// ── AiBehaviorPanel ───────────────────────────────────────────────────────────
// Lets the writer select the AI's intent mode for the current chat session.
// Each mode routes to a different system prompt on the backend.
// Only one mode is active at a time. Switching mode clears the chat.

const BEHAVIOR_MODES: { id: string; label: string; description: string }[] = [
  {
    id: "general",
    label: "General Chat",
    description: "Open-ended conversation. Ask anything about this profile.",
  },
  {
    id: "interpret_profile",
    label: "Interpret Profile",
    description: "AI reads selected context and explains how AI writing tools would use each piece -- what they'd surface, avoid, or misread.",
  },
  {
    id: "refine_traits",
    label: "Refine Traits",
    description: "Sharpens selected traits one at a time. AI asks focused questions to make the trait name and description more specific and character-grounded.",
  },
  {
    id: "ask_clarifying",
    label: "Ask Clarifying Questions",
    description: "Writer asks a question, AI answers it directly. If the question is vague, AI offers 2-3 framings first. No unsolicited observations or suggestions.",
  },
  {
    id: "generate_summary",
    label: "Generate AI Summary",
    description: "Produces a two-part summary: plain-language recap of what you wrote, then how AI writing tools would interpret it. Asks what feels off, then offers targeted suggestions.",
  },
  // Future modes added here:
  // { id: "check_consistency", ... }
];

interface AiBehaviorPanelProps {
  currentMode: string;
  open: boolean;
  onToggleOpen: () => void;
  onSelectMode: (mode: string) => void;
}

function AiBehaviorPanel({ currentMode, open, onToggleOpen, onSelectMode }: AiBehaviorPanelProps) {
  const current = BEHAVIOR_MODES.find(m => m.id === currentMode) ?? BEHAVIOR_MODES[0];

  return (
    <div className="border-b border-teal-800/40 bg-teal-950/40">

      {/* Collapsed bar */}
      <button
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-3 py-2 transition-colors hover:bg-teal-900/20"
        title="Select the AI's behavior mode for this chat session"
      >
        <div className="flex items-center gap-2">
          <Bot size={12} className="shrink-0 text-teal-400" />
          <span className="text-xs font-semibold text-teal-300">AI Behavior</span>
          <span className="rounded-full bg-teal-700/40 px-2 py-0.5 text-xs text-teal-200">
            {current.label}
          </span>
        </div>
        <ChevronDown
          size={12}
          className={`shrink-0 text-teal-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded mode list */}
      {open && (
        <div className="border-t border-teal-800/30 px-2 pb-2 pt-1.5">
          <p className="mb-2 px-1 text-xs text-teal-600">
            Choose what the AI should do with the context you've selected.
            Switching mode clears the current conversation.
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
                    : "text-teal-300 hover:bg-teal-900/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                  )}
                  {!isActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-800" />
                  )}
                  <span className="text-xs font-medium">{mode.label}</span>
                </div>
                <p className="mt-0.5 pl-3.5 text-xs text-teal-600">{mode.description}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── ToolKit Component ─────────────────────────────────────────────────────────
// The context selection panel above the chat input.
// Lets the writer choose exactly which profile sections and traits to send
// to the AI with each message, instead of the AI receiving everything at once.
//
// Teal/emerald color scheme distinguishes it visually from the rest of the panel.
// Max height 45vh before becoming internally scrollable.

interface ToolKitProps {
  profile: Profile | null;
  toolkitSections: ToolkitSection[];
  selections: Set<string>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleItem: (id: string) => void;
  onToggleSection: (sectionKey: string) => void;
  onClearAll: () => void;
}

function ToolKit({
  profile,
  toolkitSections,
  selections,
  open,
  onToggleOpen,
  onToggleItem,
  onToggleSection,
  onClearAll,
}: ToolKitProps) {
  const totalSelected = selections.size;

  return (
    <div className="border-y border-teal-800/40 bg-teal-950/40">

      {/* ── Collapsed bar (always visible) ─────────────────────────────────
          Shows the panel name, selected item count, and expand/collapse arrow.
          Clicking anywhere on this bar toggles the panel open or closed.      */}
      <button
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-3 py-2 transition-colors hover:bg-teal-900/20"
        title="Select which profile sections to send as AI context"
      >
        <div className="flex items-center gap-2">
          <Settings2 size={12} className="shrink-0 text-teal-400" />
          <span className="text-xs font-semibold text-teal-300">ToolKit</span>

          {/* Selection count badge -- shows when something is selected */}
          {totalSelected > 0 ? (
            <span className="rounded-full bg-teal-700/50 px-1.5 py-0.5 text-xs font-medium text-teal-200">
              {totalSelected} selected
            </span>
          ) : (
            <span className="text-xs text-teal-700">
              {profile ? "Overview (default)" : "open a profile"}
            </span>
          )}
        </div>

        <ChevronDown
          size={12}
          className={`shrink-0 text-teal-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* ── Expanded panel ──────────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-teal-800/30">

          {/* Description */}
          <div className="px-3 pb-1.5 pt-2">
            <p className="text-xs leading-relaxed text-teal-600">
              Choose what context the AI receives with each message.
              Name and Role are always included.
              With nothing selected, Overview is sent automatically if filled.
            </p>
          </div>

          {/* Clear all -- only visible when something is selected */}
          {totalSelected > 0 && (
            <div className="flex justify-end px-3 pb-1">
              <button
                onClick={onClearAll}
                className="text-xs text-teal-700 transition-colors hover:text-teal-400"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Item list -- scrollable once content exceeds 45% of viewport height */}
          {!profile ? (
            <p className="px-3 pb-3 text-xs text-teal-800">
              Open a profile to see available context options.
            </p>
          ) : toolkitSections.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-teal-800">
              No filled sections yet. Add content to the profile to see options here.
            </p>
          ) : (
            <div className="max-h-[45vh] overflow-y-auto px-2 pb-2">
              {toolkitSections.map(section => {
                // Section header is "checked" only when ALL items in it are selected.
                // If partial or none, it shows unchecked.
                const allChecked = section.items.every(item => selections.has(item.id));

                return (
                  <div key={section.key} className="mb-1.5">

                    {/* Section header checkbox -- selects/clears all items in this section */}
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-teal-900/20">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => onToggleSection(section.key)}
                        className="shrink-0 accent-teal-500"
                      />
                      <span className="text-xs font-semibold text-teal-300">
                        {section.label}
                        <span className="ml-1 font-normal text-teal-700">
                          ({section.items.length})
                        </span>
                      </span>
                    </label>

                    {/* Individual items -- indented under their section header.
                        Using inline style (not Tailwind ml-) to guarantee the exact
                        pixel value makes it into the rendered CSS without being
                        dropped by Tailwind's class-detection or purge step.
                        3rem = 48px indent from the left edge of the panel.
                        The teal border-left draws a vertical line connecting items
                        to the section header above them. */}
                    <div
                      style={{ marginLeft: "1.5rem", borderLeft: "2px solid rgba(20, 184, 166, 0.35)", paddingLeft: "0.5rem" }}
                    >
                      {section.items.map(item => (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-start gap-2 rounded py-1 pr-1 transition-colors hover:bg-teal-900/20"
                        >
                          <input
                            type="checkbox"
                            checked={selections.has(item.id)}
                            onChange={() => onToggleItem(item.id)}
                            className="mt-0.5 shrink-0 accent-teal-500"
                          />
                          <div className="min-w-0">
                            {/* Primary line: trait name or content preview */}
                            <p className="truncate text-xs text-teal-100">{item.label}</p>
                            {/* Secondary line: description start (shown only if present) */}
                            {item.sub && (
                              <p className="truncate text-xs text-teal-700">
                                {item.sub.slice(0, 70)}{item.sub.length > 70 ? "..." : ""}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── ChatMarkdown ──────────────────────────────────────────────────────────────
// Renders AI chat messages as formatted markdown using react-markdown.
//
// Why a custom component?
//   react-markdown renders to plain HTML elements (p, ul, li, strong, etc.)
//   with no styling. We need to apply Tailwind classes to match the dark theme
//   and keep things readable inside the chat bubble.
//
// What the AI is allowed to use (per system prompt):
//   **bold**         → <strong> → font-semibold, slightly lighter color
//   - bullet lists   → <ul>/<li> → with dot bullets, proper indentation
//   1. numbered lists → <ol>/<li> → with numbers, proper indentation
//   > blockquote     → <blockquote> → left indigo border, muted text
//   blank lines      → <p> → paragraph spacing
//
// What we block:
//   ## ### headers   → rendered as bold text instead (no large font size)
//   --- horizontal   → not rendered (empty)

function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        // Paragraphs: space between them
        p: ({ children }) => (
          <p className="mb-1.5 last:mb-0">{children}</p>
        ),

        // Bold: slightly lighter than body for emphasis without being jarring
        strong: ({ children }) => (
          <strong className="font-semibold text-[#e0e0f5]">{children}</strong>
        ),

        // Italic: subtle style
        em: ({ children }) => (
          <em className="italic text-[#c0c0e0]">{children}</em>
        ),

        // Bullet list: clear indentation, visible dots
        ul: ({ children }) => (
          <ul className="my-1.5 space-y-0.5 pl-4">{children}</ul>
        ),

        // Numbered list: same spacing as bullet
        ol: ({ children }) => (
          <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
        ),

        // List item: dot bullet handled by parent ul/ol
        li: ({ children }) => (
          <li className="leading-snug marker:text-[#6666aa]">{children}</li>
        ),

        // Blockquote: left indigo border, used for category callouts like
        // "> Completed sections:" -- gives a nice visual section break
        blockquote: ({ children }) => (
          <blockquote className="my-1.5 border-l-2 border-indigo-500 pl-3 text-[#9999bb]">
            {children}
          </blockquote>
        ),

        // Headings (## ###): not used in the chat system prompts.
        // Render as bold text if the model produces them anyway,
        // so they don't break the chat bubble layout with large font sizes.
        h1: ({ children }) => <p className="font-semibold text-[#e0e0f5]">{children}</p>,
        h2: ({ children }) => <p className="font-semibold text-[#e0e0f5]">{children}</p>,
        h3: ({ children }) => <p className="font-semibold text-[#d0d0f0]">{children}</p>,

        // Horizontal rule (---): now actively encouraged in format_rules as
        // a visual separator between distinct sections of a response.
        // Rendered as a gradient line that fades at the edges -- visible but
        // not harsh against the dark chat bubble background.
        hr: () => (
          <div className="my-3 h-px bg-gradient-to-r from-transparent via-[#3a3a6a] to-transparent" />
        ),

        // Inline code: monospace pill for any code snippets
        code: ({ children }) => (
          <code className="rounded bg-[#070724] px-1 py-0.5 font-mono text-xs text-[#a5b4fc]">
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
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
