// utils/buildEditorChatPayload.ts
// ================================================================
// Pure helper that decides WHAT materials a Writing Companion turn should
// send to /api/ai/editor-chat. Pulled out of App.tsx so the branching logic
// (selection vs full chapter vs nothing, which chips are new, which category)
// can be unit-tested without rendering the whole app.
//
// The backend is stateless and the frontend owns conversation history, so on
// follow-up turns we deliberately resend only NEW materials -- things the AI
// has not seen yet. Anything "established" (sent in a prior turn) already
// lives in the message history and would just waste tokens if resent.

import type { ContextChip, EditorChatCategory } from "../types/ai";

export interface BuildEditorChatPayloadInput {
  /** The category to send. "chat" for discussion, "draft" for prose drafting. */
  category: EditorChatCategory;
  /** Raw selected text from the editor (may be empty / whitespace). */
  selectedText: string;
  /** Full chapter text, or null when no editor view is available. */
  fullChapterText: string | null;
  /** Whether the "include chapter" toggle is on. */
  includeChapter: boolean;
  /** Whether the full chapter was already sent earlier in this conversation. */
  chapterEstablished: boolean;
  /** All chips the writer has attached. */
  contextChips: ContextChip[];
  /** Keys ("type:name") of chips already sent in a prior turn. */
  establishedChipKeys: Set<string>;
  /**
   * When true, send NO chapter/selection text at all. Used by the Continue
   * button: the prose so far is already in the message history, so the model
   * just needs the canned "keep going" turn, not a fresh passage.
   */
  suppressText?: boolean;
}

export interface BuiltEditorChatPayload {
  category: EditorChatCategory;
  text_content: string;
  is_full_chapter: boolean;
  /** Only the chips that are new this turn. */
  context_chips: ContextChip[];
}

/**
 * Decide the text + chips to attach to this turn. Mirrors the original inline
 * logic in App.tsx: a fresh selection is always sent; otherwise the full
 * chapter is sent once (toggle on, not yet established); otherwise nothing.
 */
export function buildEditorChatPayload(
  input: BuildEditorChatPayloadInput,
): BuiltEditorChatPayload {
  const {
    category,
    selectedText,
    fullChapterText,
    includeChapter,
    chapterEstablished,
    contextChips,
    establishedChipKeys,
    suppressText = false,
  } = input;

  let text_content = "";
  let is_full_chapter = false;

  if (!suppressText) {
    const selected = selectedText.trim();
    if (selected) {
      // Writer highlighted a specific passage -- always new context.
      text_content = selected;
      is_full_chapter = false;
    } else if (includeChapter && !chapterEstablished && fullChapterText != null) {
      // No selection, toggle on, chapter not yet sent in this conversation.
      text_content = fullChapterText;
      is_full_chapter = true;
    }
    // Otherwise leave text empty: toggle off, or chapter already established.
  }

  // Only chips not already established (sent in a prior turn) go on the wire.
  const context_chips = contextChips.filter(
    (chip) => !establishedChipKeys.has(`${chip.type}:${chip.name}`),
  );

  return { category, text_content, is_full_chapter, context_chips };
}

// ── Weak-model detection for the drafting nudge ─────────────────────────────
// Drafting quality leans heavily on the model. These substrings flag the cheap
// / budget tiers that tend to produce generic prose, so we can show a one-time,
// non-blocking nudge suggesting a stronger model. This never blocks a request.
const WEAK_MODEL_SUBSTRINGS = ["gpt-4o-mini", "gpt-3.5", "gpt-4.1-mini", ":free", "haiku"];

/**
 * Returns true if the given model id looks like a weak/budget tier that tends
 * to produce low-quality drafted prose. Case-insensitive substring match.
 */
export function isWeakDraftingModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return WEAK_MODEL_SUBSTRINGS.some((s) => lower.includes(s));
}
