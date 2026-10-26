// components/chat/ChatSessions.tsx -- conversations you can come back to
// ========================================================================
// One picker, used by both chats. The Writing Companion lists every
// conversation about the book; the Profile Builder lists the ones about
// profiles, titled by who they were about.
//
// THE WORDING IS BORROWED ON PURPOSE. Weaving has offered "Carry on where you
// left off" versus "Start fresh" since v2.0.0, and the writer has already
// learned what those mean. A second pair of words for the same idea would be
// this app's most common failure -- one idea with two vocabularies -- so this
// says "Carry on" too.
//
// What it deliberately does NOT do:
//
//   - It does not autosave the current conversation on open. Saving happens
//     after each completed turn, in the caller. A picker that wrote on open
//     would create an empty session every time the writer looked at the list.
//   - It does not decide what reopening MEANS. The caller restores the
//     transcript and the setup, because only the caller knows what its panel
//     is made of. This hands back a session and gets out of the way.

import { useCallback, useEffect, useState } from "react";
import { History, Loader, MessageSquare, Plus, Trash2, X } from "lucide-react";

import {
  chatLabel, deleteChat, fetchChats,
  type ChatSummary, type ChatSurface,
} from "../../utils/chatSessions";
import { Explain } from "../learn/Explain";

interface Props {
  projectPath: string;
  surface: ChatSurface;
  /** The session on screen, so the list can mark it and not offer to reopen it. */
  currentChatId: string | null;
  /** Bumped by the caller after a save, so the list picks up a new session
   *  or a changed title without being reopened. */
  refreshKey?: number;
  /** Reopen one. The caller decides what that restores. */
  onOpen: (chatId: string) => void;
  /** Put the current conversation away and begin an empty one. */
  onStartFresh: () => void;
  /** True while the caller is mid-restore, so rows cannot be double-clicked. */
  busy?: boolean;
  /** Why this session cannot be opened from where the writer is standing,
   *  or "" when it can.
   *
   *  Exists for the Profile Builder, where a conversation is ABOUT somebody.
   *  Reopening Gandalf's chat while looking at Frodo would put Gandalf's
   *  transcript next to Frodo's profile and send both -- so the row says
   *  where to go instead of doing something incoherent. Not hidden: seeing
   *  the whole history is the point of the list, and a row that vanishes
   *  teaches nothing. */
  blockedReason?: (chat: ChatSummary) => string;
}

export function ChatSessions({
  projectPath, surface, currentChatId, refreshKey = 0,
  onOpen, onStartFresh, busy = false, blockedReason,
}: Props) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState("");
  // Two-step delete. A conversation is not recoverable and the rows are small
  // and close together, so one click cannot be enough.
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectPath) return;
    setError("");
    fetchChats(projectPath, surface)
      .then(setChats)
      .catch(err => {
        // Say so rather than showing an empty list. "You have no saved
        // conversations" and "I could not read them" look identical and mean
        // opposite things -- this app has lost a Recent Projects list twice
        // to exactly that.
        setChats([]);
        setError(err instanceof Error ? err.message : "Could not read your conversations.");
      });
  }, [projectPath, surface]);

  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  // Keep the count honest while the panel is shut, so the button can say
  // whether there is anything behind it.
  useEffect(() => { load(); }, [load, refreshKey]);

  const count = chats?.length ?? 0;

  async function remove(chatId: string) {
    try {
      await deleteChat(projectPath, chatId);
      setConfirming(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that conversation.");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        data-testid="chat-sessions-button"
        aria-expanded={open}
        title="Conversations you can come back to"
        className="flex items-center gap-1 text-xs text-faint transition-colors hover:text-text-primary"
      >
        <History size={12} />
        {count > 0 ? `Past chats (${count})` : "Past chats"}
      </button>

      {open && (
        <div
          data-testid="chat-sessions-panel"
          className="absolute right-0 top-6 z-40 w-80 rounded-lg border border-border bg-bg-panel p-2 shadow-xl"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs font-medium text-text-primary">
              <MessageSquare size={12} className="text-accent" />
              Past chats
            </span>
            <div className="flex items-center gap-1">
              <Explain of="chat-sessions.what" compact />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close past chats"
                className="rounded p-0.5 text-faint hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Offered ABOVE the list, because starting fresh is what the writer
              wants at least as often as reopening -- and burying it under
              twenty rows would make it look like it was not there. */}
          <button
            onClick={() => { onStartFresh(); setOpen(false); }}
            disabled={busy}
            data-testid="chat-start-fresh"
            className="mb-1 flex w-full items-center gap-1.5 rounded border border-border px-2 py-1 text-left text-xs text-text-primary hover:bg-accent-fill/20 disabled:opacity-50"
          >
            <Plus size={11} className="text-accent" />
            <span>
              Start fresh
              <span className="block text-micro text-faint">
                Puts this conversation away. It stays in this list.
              </span>
            </span>
          </button>

          {error && (
            <p role="alert" className="px-1 py-1 text-micro text-danger">{error}</p>
          )}

          {chats === null ? (
            <p className="flex items-center gap-1.5 px-1 py-2 text-micro text-faint">
              <Loader size={11} className="animate-spin" /> Reading...
            </p>
          ) : chats.length === 0 && !error ? (
            /* AND NOT ERROR. Without that guard a failed read renders the
               alert AND "nothing saved yet" together, which reads as "it
               broke, and also you have none" -- the writer starts over
               anyway. The test for this found it in this very component. */
            <p className="px-1 py-2 text-micro text-faint">
              Nothing saved yet. Conversations are kept as you have them, so
              you can come back to one instead of starting over.
            </p>
          ) : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {chats.map(chat => {
                const isCurrent = chat.chat_id === currentChatId;
                const blocked = isCurrent ? "" : (blockedReason?.(chat) ?? "");
                return (
                  <li key={chat.chat_id}>
                    {confirming === chat.chat_id ? (
                      <div className="flex items-center gap-1 rounded bg-danger-soft/20 px-2 py-1">
                        <span className="min-w-0 flex-1 truncate text-micro text-text-primary">
                          Delete this conversation? It cannot be undone.
                        </span>
                        <button
                          onClick={() => void remove(chat.chat_id)}
                          className="shrink-0 rounded border border-danger-fill px-1.5 py-0.5 text-micro text-danger"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="shrink-0 text-micro text-faint hover:text-text-primary"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className={`group flex items-center gap-1 rounded px-2 py-1 ${
                        isCurrent ? "bg-accent-fill/20" : "hover:bg-bg-raised"
                      }`}>
                        <button
                          onClick={() => { if (!isCurrent && !blocked) { onOpen(chat.chat_id); setOpen(false); } }}
                          disabled={busy || isCurrent || Boolean(blocked)}
                          className="min-w-0 flex-1 text-left disabled:cursor-default"
                        >
                          <span className="block truncate text-xs text-text-primary">
                            {chatLabel(chat)}
                          </span>
                          <span className="block text-micro text-faint">
                            {chat.turns} {chat.turns === 1 ? "message" : "messages"}
                            {isCurrent && " -- on screen now"}
                            {blocked && ` -- ${blocked}`}
                            {/* Said BEFORE they open it, because it is the one
                                thing here that can cost money. */}
                            {!isCurrent && !blocked && chat.turns > 8 && " -- long, may be summarised"}
                          </span>
                        </button>
                        <button
                          onClick={() => setConfirming(chat.chat_id)}
                          aria-label={`Delete ${chat.title}`}
                          className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
