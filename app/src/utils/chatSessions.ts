// utils/chatSessions.ts -- conversations the writer can come back to
// ===================================================================
// The client for /api/chats, plus the one piece of formatting the picker
// needs and the app did not have: "4 days ago".
//
// Everything here is deliberately small. The interesting decisions are in
// backend/app/chat_sessions.py (why sessions are files rather than rows, and
// why a hidden materials turn is stored as a descriptor rather than its text)
// and in App.tsx (what a session has to restore for a resumed conversation
// not to re-send the chapter).

const API_BASE = "http://localhost:8000";

/** Which chat a session belongs to. Mirrors SURFACES in chat_sessions.py. */
export type ChatSurface = "companion" | "profile";

export interface ChatSummary {
  chat_id: string;
  surface: ChatSurface;
  /** A profile name, or the chapter that was open. */
  subject: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Turns the writer can SEE -- hidden materials are not counted. */
  turns: number;
  has_recap: boolean;
}

export interface SavedChat extends ChatSummary {
  messages: ChatStoredMessage[];
  setup: Record<string, unknown>;
  recap: string;
  recap_through: number;
}

/** What a hidden materials turn becomes on disk: what was attached, never the
 *  text. See the module docstring in chat_sessions.py. */
export interface MaterialsDescriptor {
  chips: string[];
  had_chapter: boolean;
  had_world: boolean;
  had_outline: boolean;
  had_ai_notes: boolean;
  tokens: number;
}

export interface ChatStoredMessage {
  role: "user" | "assistant";
  content?: string;
  reasoning?: string;
  hidden?: boolean;
  materials?: MaterialsDescriptor;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `Request failed (${res.status}).`;
    try { detail = (await res.json())?.detail ?? detail; } catch { /* keep it */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function fetchChats(
  projectPath: string, surface?: ChatSurface,
): Promise<ChatSummary[]> {
  const params = new URLSearchParams({ project_path: projectPath });
  if (surface) params.set("surface", surface);
  const body = await json<{ chats: ChatSummary[] }>(
    await fetch(`${API_BASE}/api/chats?${params}`));
  return body.chats ?? [];
}

export async function fetchChat(
  projectPath: string, chatId: string,
): Promise<SavedChat> {
  const params = new URLSearchParams({
    project_path: projectPath, chat_id: chatId,
  });
  return json<SavedChat>(await fetch(`${API_BASE}/api/chats/one?${params}`));
}

/**
 * Save after a completed turn.
 *
 * `chatId` is null on the first save of a conversation -- the BACKEND mints
 * the id and hands it back, and the caller must keep it. Sending null again
 * on the next turn would file every turn as its own one-turn session.
 */
export async function saveChat(args: {
  projectPath: string;
  surface: ChatSurface;
  chatId: string | null;
  subject?: string;
  title?: string;
  messages: ChatStoredMessage[];
  setup: Record<string, unknown>;
}): Promise<{ chat_id: string; title: string; updated_at: string }> {
  return json(await fetch(`${API_BASE}/api/chats/one`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: args.projectPath,
      surface: args.surface,
      chat_id: args.chatId,
      subject: args.subject ?? "",
      title: args.title ?? "",
      messages: args.messages,
      setup: args.setup,
    }),
  }));
}

export async function deleteChat(
  projectPath: string, chatId: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    project_path: projectPath, chat_id: chatId,
  });
  const body = await json<{ removed: boolean }>(
    await fetch(`${API_BASE}/api/chats/one?${params}`, { method: "DELETE" }));
  return body.removed;
}

export async function renameChat(
  projectPath: string, chatId: string, title: string,
): Promise<string> {
  const body = await json<{ title: string }>(
    await fetch(`${API_BASE}/api/chats/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_path: projectPath, chat_id: chatId, title,
      }),
    }));
  return body.title;
}


// ── "4 days ago" ─────────────────────────────────────────────────────────────

/**
 * How long ago, in the words a person would use.
 *
 * CALENDAR DAYS, NOT ELAPSED HOURS, and the difference is the whole point. A
 * conversation at 11pm last night is "yesterday" to the writer at 9am, not
 * "10 hours ago" and certainly not "today" -- which is what dividing a
 * duration by 86,400,000 would give. The picker exists so they can recognise
 * a session at a glance, and the day they had it is how they remember it.
 *
 * An unparseable or future timestamp returns "" rather than guessing. A clock
 * that went backwards (a laptop resuming, a timezone change mid-session) must
 * not produce "in -3 days" next to a real conversation.
 */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (!iso || Number.isNaN(then.getTime())) return "";

  // Compare midnights in LOCAL time. Doing this arithmetic in UTC would put
  // an evening conversation on the wrong side of the boundary for anyone west
  // of Greenwich.
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000);

  if (days < 0) return "";           // a clock that went backwards
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  // A PLAIN COUNT OF DAYS, well past the point where a date library would
  // switch to weeks, because that is what was asked for -- "4 days ago",
  // "23 days ago". It is also the better answer here: these labels are for
  // RECOGNISING a conversation, and "23 days ago" pins it to a week of work
  // the writer can place, where "3 weeks ago" rounds that away.
  if (days < 90) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return days < 730 ? "a year ago" : `${Math.floor(days / 365)} years ago`;
}

/** The picker's one-line label: "4 days ago -- Frodo Baggins -- what he wants" */
export function chatLabel(chat: ChatSummary): string {
  const when = relativeDay(chat.updated_at);
  return when ? `${when} -- ${chat.title}` : chat.title;
}
