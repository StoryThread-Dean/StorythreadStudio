// components/chat/ChatSessions.test.tsx
// =====================================
// The picker. What it protects, in order of how badly each fails:
//
//   1. "I could not read your conversations" must never render as "you have
//      none". This app has lost a Recent Projects list twice to exactly that
//      -- an empty result is indistinguishable from a failed one unless the
//      screen says which.
//   2. Deleting is not recoverable and the rows are small and adjacent, so
//      one click cannot be enough.
//   3. Reopening a long conversation can cost a recap. The list says so
//      BEFORE it is opened, rather than surprising the writer with a request
//      they did not ask for.

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSessions } from "./ChatSessions";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

/** Days before "now", so the labels do not rot as the calendar moves. */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const CHATS = [
  { chat_id: "chat-000000000001", surface: "companion", subject: "Chapter Seven",
    title: "how should this land?", created_at: daysAgo(4),
    updated_at: daysAgo(4), turns: 12, has_recap: false },
  { chat_id: "chat-000000000002", surface: "companion", subject: "",
    title: "the ending problem", created_at: daysAgo(0),
    updated_at: daysAgo(0), turns: 2, has_recap: false },
];

let deleted: string[] = [];

function mockApi(over: { fail?: boolean; chats?: unknown[] } = {}) {
  deleted = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      deleted.push(new URL(url).searchParams.get("chat_id") ?? "");
      return { ok: true, json: async () => ({ removed: true }) } as Response;
    }
    if (over.fail) {
      return { ok: false, status: 500,
               json: async () => ({ detail: "Could not read your conversations." }) } as Response;
    }
    return { ok: true, json: async () => ({ chats: over.chats ?? CHATS }) } as Response;
  }));
}

beforeEach(() => mockApi());

async function openPicker(props: Partial<Parameters<typeof ChatSessions>[0]> = {}) {
  const onOpen = vi.fn();
  const onStartFresh = vi.fn();
  render(
    <ChatSessions
      projectPath={PROJECT}
      surface="companion"
      currentChatId={null}
      onOpen={onOpen}
      onStartFresh={onStartFresh}
      {...props}
    />,
  );
  await userEvent.click(screen.getByTestId("chat-sessions-button"));
  await screen.findByTestId("chat-sessions-panel");
  return { onOpen, onStartFresh };
}


describe("the button", () => {
  it("says how many there are without being opened", async () => {
    render(
      <ChatSessions projectPath={PROJECT} surface="companion"
                    currentChatId={null} onOpen={vi.fn()} onStartFresh={vi.fn()} />,
    );
    expect(await screen.findByText("Past chats (2)")).toBeTruthy();
  });

  it("does not promise a count it does not have", async () => {
    mockApi({ chats: [] });
    render(
      <ChatSessions projectPath={PROJECT} surface="companion"
                    currentChatId={null} onOpen={vi.fn()} onStartFresh={vi.fn()} />,
    );
    expect(await screen.findByText("Past chats")).toBeTruthy();
  });
});


describe("the list", () => {
  it("labels each one the way the writer asked -- when, then what", async () => {
    await openPicker();
    expect(screen.getByText("4 days ago -- how should this land?")).toBeTruthy();
    expect(screen.getByText("today -- the ending problem")).toBeTruthy();
  });

  it("counts messages the writer can see", async () => {
    await openPicker();
    expect(screen.getByText(/12 messages/)).toBeTruthy();
  });

  it("says which one is on screen, and will not reopen it", async () => {
    const { onOpen } = await openPicker({ currentChatId: "chat-000000000002" });
    expect(screen.getByText(/on screen now/)).toBeTruthy();
    await userEvent.click(screen.getByText("today -- the ending problem"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("warns that a long one may be summarised, before it is opened", async () => {
    // The one thing in this panel that can cost money. Saying it afterwards
    // would be telling the writer about a request they have already paid for.
    await openPicker();
    expect(screen.getByText(/may be summarised/)).toBeTruthy();
  });

  it("does not warn about a short one", async () => {
    mockApi({ chats: [CHATS[1]] });
    await openPicker();
    expect(screen.queryByText(/may be summarised/)).toBeNull();
  });

  it("hands the id back and closes", async () => {
    const { onOpen } = await openPicker();
    await userEvent.click(screen.getByText("4 days ago -- how should this land?"));
    expect(onOpen).toHaveBeenCalledWith("chat-000000000001");
    expect(screen.queryByTestId("chat-sessions-panel")).toBeNull();
  });
});


describe("an empty list and a broken one are not the same thing", () => {
  it("says nothing is saved yet, and why that is normal", async () => {
    mockApi({ chats: [] });
    await openPicker();
    expect(screen.getByText(/Nothing saved yet/)).toBeTruthy();
  });

  it("says it FAILED rather than showing an empty list", async () => {
    // THE ONE THAT MATTERS. A writer told "nothing saved yet" when their
    // conversations exist but could not be read will start over, and this
    // repo has shipped that bug twice on other lists.
    mockApi({ fail: true });
    await openPicker();
    expect(screen.getByRole("alert").textContent).toMatch(/Could not read/);
    expect(screen.queryByText(/Nothing saved yet/)).toBeNull();
  });
});


describe("start fresh", () => {
  it("is offered above the list, not buried under it", async () => {
    const { onStartFresh } = await openPicker();
    await userEvent.click(screen.getByTestId("chat-start-fresh"));
    expect(onStartFresh).toHaveBeenCalled();
  });

  it("says the current conversation is kept", async () => {
    // "Start fresh" reads like "throw this away" unless it is contradicted.
    await openPicker();
    expect(screen.getByText(/stays in this list/)).toBeTruthy();
  });
});


describe("deleting", () => {
  it("asks first", async () => {
    await openPicker();
    await userEvent.click(screen.getByLabelText("Delete how should this land?"));
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(deleted).toHaveLength(0);
  });

  it("keeps it when the writer says keep", async () => {
    await openPicker();
    await userEvent.click(screen.getByLabelText("Delete how should this land?"));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(deleted).toHaveLength(0);
    expect(screen.getByText("4 days ago -- how should this land?")).toBeTruthy();
  });

  it("deletes on the second click", async () => {
    await openPicker();
    await userEvent.click(screen.getByLabelText("Delete how should this land?"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toEqual(["chat-000000000001"]));
  });
});


describe("it explains itself", () => {
  it("offers What's this?", async () => {
    await openPicker();
    expect(screen.getAllByRole("button", { name: /What.s this/i }).length)
      .toBeGreaterThan(0);
  });
});


describe("a conversation that belongs somewhere else", () => {
  // The Profile Builder case. A chat is ABOUT somebody, and opening Gandalf's
  // while looking at Frodo would put Gandalf's transcript beside Frodo's
  // profile and send both.
  const OTHERS = [
    { chat_id: "chat-00000000000a", surface: "profile", subject: "Frodo Baggins",
      title: "Frodo Baggins -- relationships buildout", created_at: daysAgo(4),
      updated_at: daysAgo(4), turns: 12, has_recap: false },
    { chat_id: "chat-00000000000b", surface: "profile", subject: "Gandalf the White",
      title: "Gandalf the White -- Overview update", created_at: daysAgo(14),
      updated_at: daysAgo(14), turns: 5, has_recap: false },
  ];

  const openAsFrodo = async () => {
    mockApi({ chats: OTHERS });
    const onOpen = vi.fn();
    render(
      <ChatSessions
        projectPath={PROJECT} surface="profile" currentChatId={null}
        onOpen={onOpen} onStartFresh={vi.fn()}
        blockedReason={c => (c.subject !== "Frodo Baggins"
          ? `open ${c.subject} to carry on` : "")}
      />,
    );
    await userEvent.click(screen.getByTestId("chat-sessions-button"));
    await screen.findByTestId("chat-sessions-panel");
    return { onOpen };
  };

  it("still SHOWS it -- seeing the whole history is the point", async () => {
    // Hiding it would leave the writer wondering where a conversation they
    // remember having has gone.
    await openAsFrodo();
    expect(screen.getByText("14 days ago -- Gandalf the White -- Overview update"))
      .toBeTruthy();
  });

  it("says where to go rather than failing when clicked", async () => {
    const { onOpen } = await openAsFrodo();
    expect(screen.getByText(/open Gandalf the White to carry on/)).toBeTruthy();
    await userEvent.click(
      screen.getByText("14 days ago -- Gandalf the White -- Overview update"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the one that does belong here", async () => {
    const { onOpen } = await openAsFrodo();
    await userEvent.click(
      screen.getByText("4 days ago -- Frodo Baggins -- relationships buildout"));
    expect(onOpen).toHaveBeenCalledWith("chat-00000000000a");
  });

  it("reads the way the writer described it", async () => {
    // Their own words: "4 days ago - Frodo Baggins - relationships buildout,
    // 14 days ago - Gandolf the white - Overview update".
    await openAsFrodo();
    expect(screen.getByText("4 days ago -- Frodo Baggins -- relationships buildout"))
      .toBeTruthy();
  });
});
