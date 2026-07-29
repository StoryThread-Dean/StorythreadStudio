// utils/buildEditorChatPayload.ts
// ================================================================
// Pure helper that decides WHAT materials a Writing Companion turn should
// send to /api/ai/editor-chat. Pulled out of App.tsx so the branching logic
// (selection vs full chapter vs nothing, which chips are new, which category)
// can be unit-tested without rendering the whole app.
//
// The backend is stateless and the frontend owns conversation history, so on
// follow-up turns we deliberately resend only NEW materials -- things the AI
// has already seen live in the message history and would just waste tokens
// if resent. That "lives in the history" part is real, not aspirational: the
// backend echoes each turn's materials block back (materials_content), and
// appendTurnToHistory() below persists it as a hidden history message. So an
// attached character profile genuinely stays in front of the model on every
// later turn -- the fix for characters losing their voice after turn one.

import type { ContextChip, EditorChatCategory, EditorChatMessage, EnhanceLevel } from "../types/ai";

export interface BuildEditorChatPayloadInput {
  /** The category to send. "chat" for discussion, "draft" for prose drafting, "enhance" to expand a selection. */
  category: EditorChatCategory;
  /** Raw selected text from the editor (may be empty / whitespace). */
  selectedText: string;
  /** Full chapter text, or null when no editor view is available. */
  fullChapterText: string | null;
  /** Whether the "include chapter" toggle is on. */
  includeChapter: boolean;
  /** Whether the full chapter was already sent earlier in this conversation. */
  chapterEstablished: boolean;
  /**
   * The selection text (trimmed) that was already sent AND persisted into the
   * chat history in a prior turn ("" when none). When the current selection is
   * byte-identical to this, we skip resending it -- it's genuinely in front of
   * the model already via the hidden materials message. Without this check,
   * a selection that stays highlighted across turns (highlights deliberately
   * persist) would be rebuilt into a fresh materials block EVERY turn and each
   * echo appended to history -- one full duplicate copy per turn, ballooning
   * the payload until slow models hit the request timeout.
   */
  establishedSelection?: string;
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
  /** Enhance mode only: the expansion level to send. */
  enhanceLevel?: EnhanceLevel;
  /**
   * Enhance mode only: the precomputed window of paragraphs around the
   * selection (grounding). Computed by the caller via computeSurroundingWindow
   * because it needs the live selection offsets into the full chapter.
   */
  surroundingContext?: string;
}

export interface BuiltEditorChatPayload {
  category: EditorChatCategory;
  text_content: string;
  is_full_chapter: boolean;
  /** Only the chips that are new this turn. */
  context_chips: ContextChip[];
  /** Enhance mode only: grounding window ("" for other modes). */
  surrounding_context: string;
  /** Enhance mode only: expansion level (defaults to "prompt"). */
  enhance_level: EnhanceLevel;
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
    establishedSelection = "",
    contextChips,
    establishedChipKeys,
    suppressText = false,
    enhanceLevel = "default",
    surroundingContext = "",
  } = input;

  let text_content = "";
  let is_full_chapter = false;
  let surrounding_context = "";

  if (!suppressText) {
    const selected = selectedText.trim();
    if (category === "enhance") {
      // Enhance always operates on the highlighted selection and ALWAYS resends
      // it (and its grounding window) every turn -- the exact target must be in
      // front of the model on follow-ups like "now make it darker", so we
      // deliberately ignore chapterEstablished here. text_content may be "" when
      // nothing is highlighted; the caller blocks the send in that case.
      text_content = selected;
      is_full_chapter = false;
      surrounding_context = surroundingContext;
    } else if (selected && selected !== establishedSelection.trim()) {
      // Writer highlighted a specific passage that hasn't been sent yet (or
      // changed the highlight since) -- send it as new context. An UNCHANGED
      // established selection is skipped entirely: it already lives in the
      // history as a hidden materials message, so resending it would just
      // stack duplicate copies (see establishedSelection above).
      text_content = selected;
      is_full_chapter = false;
    } else if (!selected && includeChapter && !chapterEstablished && fullChapterText != null) {
      // No selection, toggle on, chapter not yet sent in this conversation.
      text_content = fullChapterText;
      is_full_chapter = true;
    }
    // Otherwise leave text empty: toggle off, chapter already established,
    // or the current selection is unchanged from one already in the history.
  }

  // Only chips not already established (sent in a prior turn) go on the wire.
  const context_chips = contextChips.filter(
    (chip) => !establishedChipKeys.has(`${chip.type}:${chip.name}`),
  );

  return {
    category,
    text_content,
    is_full_chapter,
    context_chips,
    surrounding_context,
    enhance_level: enhanceLevel,
  };
}

// ── History persistence for a completed turn ────────────────────────────────

/**
 * Append one completed Writing Companion turn to the chat history.
 *
 * Order matters: the hidden materials message goes immediately BEFORE the
 * user message that triggered it -- the same position the backend gave it on
 * the wire -- so the history the model sees next turn is byte-identical to
 * what it already processed. That append-only shape is also what lets
 * provider-side prompt caching keep matching the growing prefix.
 *
 * materialsContent is the backend's echo of the materials block it built
 * (chips + chapter text); null when the turn carried no new materials (or in
 * enhance mode, which resends its passage fresh every turn instead).
 *
 * Pure function so vitest can pin the ordering without rendering the app.
 */
export function appendTurnToHistory(
  history: EditorChatMessage[],
  userMsg: EditorChatMessage,
  materialsContent: string | null | undefined,
  assistantMsg: EditorChatMessage,
): EditorChatMessage[] {
  const next = [...history];
  if (materialsContent) {
    next.push({ role: "user", content: materialsContent, hidden: true });
  }
  next.push(userMsg, assistantMsg);
  return next;
}

// ── Surrounding-context window for enhance mode ─────────────────────────────
// Enhance expands ONLY the highlighted selection, but the model needs grounding
// (what just happened, who's present, how the scene resolves). We give it a
// window of whole paragraphs immediately before and after the selection. Pure
// function so it can be unit-tested without an editor.
//
//   fullText           the whole chapter
//   selectionFrom/To   character offsets of the selection within fullText
//   paragraphsEachSide how many blank-line-delimited paragraphs to take per side
//   maxChars           hard cap on the combined window (trims far paragraphs
//                      first, then truncates the outermost kept block)
export function computeSurroundingWindow(
  fullText: string,
  selectionFrom: number,
  selectionTo: number,
  paragraphsEachSide = 3,
  maxChars = 12_000,
): string {
  if (!fullText || selectionFrom < 0 || selectionTo > fullText.length || selectionFrom > selectionTo) {
    return "";
  }

  const before = fullText.slice(0, selectionFrom);
  const after = fullText.slice(selectionTo);

  // Split into paragraphs on blank lines. Keep only non-empty blocks.
  const splitParas = (s: string) =>
    s.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);

  const beforeParas = splitParas(before).slice(-paragraphsEachSide);
  const afterParas = splitParas(after).slice(0, paragraphsEachSide);

  if (beforeParas.length === 0 && afterParas.length === 0) return "";

  // Assemble with a marker showing where the selected passage sits.
  let beforeBlock = beforeParas.join("\n\n");
  let afterBlock = afterParas.join("\n\n");

  // Enforce the cap. We bias toward keeping text nearest the selection, so trim
  // the outer (farther) ends: drop leading "before" paragraphs and trailing
  // "after" paragraphs until under the cap, then hard-truncate if still over.
  const assemble = (b: string, a: string) =>
    [b, "[... selected passage ...]", a].filter(s => s.length > 0).join("\n\n");

  let combined = assemble(beforeBlock, afterBlock);
  if (combined.length > maxChars) {
    // Hard-truncate from the outer edges inward as a last resort.
    const overflow = combined.length - maxChars;
    // Trim half from the start of beforeBlock, half from the end of afterBlock.
    const trimEach = Math.ceil(overflow / 2);
    beforeBlock = beforeBlock.slice(Math.min(trimEach, beforeBlock.length));
    afterBlock = afterBlock.slice(0, Math.max(0, afterBlock.length - trimEach));
    combined = assemble(beforeBlock, afterBlock);
    if (combined.length > maxChars) combined = combined.slice(0, maxChars);
  }

  return combined;
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
