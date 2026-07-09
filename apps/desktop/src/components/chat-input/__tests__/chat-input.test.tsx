import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../chat-input";

const mockSendPrompt = vi.fn();
const mockReplyPermission = vi.fn();
const mockSessionStore = {
  current: {
    streaming: { phase: "idle" },
    turns: [],
  } as Record<string, unknown>,
};

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      sendPrompt: mockSendPrompt,
      replyPermission: mockReplyPermission,
    },
    sessions: {
      get: () => ({ store: mockSessionStore.current }),
    },
    server: {
      store: {
        activeProjectId: "proj1",
        sessions: {
          s1: { modelId: "test-model", profileId: null, projectId: "proj1" },
        },
        projects: {
          proj1: {
            id: "proj1",
            name: "P",
            cwd: "/tmp/proj",
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
    },
    api: {
      api: {
        auth: { $get: async () => ({ ok: false, json: async () => [] }) },
        profiles: { $get: async () => ({ ok: false, json: async () => [] }) },
        projects: {
          ":id": {
            context: {
              $get: async () => ({
                ok: true,
                json: async () => ({
                  commands: [
                    { name: "commit", description: "d" },
                    { name: "status", description: "s" },
                  ],
                  skills: [],
                  agents: [],
                }),
              }),
            },
            files: {
              $get: async () => ({
                ok: true,
                json: async () => ({
                  files: [{ kind: "file", path: "src/a.ts" }],
                }),
              }),
            },
          },
        },
        models: {
          available: {
            $get: async () => ({ ok: false, json: async () => [] }),
            ":provider": {
              $get: async () => ({ ok: false, json: async () => [] }),
            },
          },
          connected: {
            $get: async () => ({ ok: false, json: async () => [] }),
          },
        },
      },
    },
  }),
}));

/** Type into the chip editor the way jsdom allows: mutate text + fire input. */
function typeInto(editor: HTMLElement, text: string) {
  editor.textContent = text;
  fireEvent.input(editor);
}

function caretAtStart(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretAtEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

afterEach(() => {
  cleanup();
  mockSessionStore.current = {
    streaming: { phase: "idle" },
    turns: [],
  };
  mockSendPrompt.mockClear();
  mockReplyPermission.mockClear();
});

describe("ChatInput", () => {
  it("renders the chip editor with a placeholder overlay", () => {
    render(() => <ChatInput placeholder="Type here…" sessionId="s1" />);
    expect(screen.getByText("Type here…")).toBeTruthy();
  });

  it("keeps input enabled when sessionId is null", () => {
    render(() => <ChatInput sessionId={null} />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    expect(editor.getAttribute("contenteditable")).toBe("true");
  });

  it("sends message on Enter, clears the editor", () => {
    render(() => <ChatInput sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    typeInto(editor, "hello world");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(mockSendPrompt).toHaveBeenCalledWith("s1", "hello world");
    expect(editor.textContent).toBe("");
  });

  it("does not send on Shift+Enter", () => {
    render(() => <ChatInput sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    typeInto(editor, "line break");
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(mockSendPrompt).not.toHaveBeenCalled();
  });

  it("does not send when empty", () => {
    render(() => <ChatInput sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(mockSendPrompt).not.toHaveBeenCalled();
  });

  it("renders the permission strip and wires replyPermission when a request is pending", async () => {
    mockSessionStore.current = {
      streaming: { phase: "idle" },
      turns: [],
      permission: {
        id: "per_1",
        permission: "read",
        patterns: ["secret.env"],
        toolName: "read",
        toolCallId: "c1",
      },
    };
    render(() => <ChatInput sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(mockReplyPermission).toHaveBeenCalledWith("s1", "per_1", "once");
  });
});

describe("ChatInput context menus", () => {
  it("opens the / menu when / is typed at the editor start", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(editor);
    fireEvent.keyDown(editor, { key: "/" });
    expect(await screen.findByText("commit")).toBeTruthy();
    expect(screen.getByText("Commands")).toBeTruthy();
  });

  it("opens the @ menu when @ is typed mid-text", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    typeInto(editor, "see ");
    caretAtEnd(editor);
    fireEvent.keyDown(editor, { key: "@" });
    expect(await screen.findByText("src/a.ts")).toBeTruthy();
  });

  it("inserts the picked token as a chip (/ mode)", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(editor);
    fireEvent.keyDown(editor, { key: "/" });
    const item = await screen.findByText("commit");
    fireEvent.click(item);
    const chip = editor.querySelector('.chip[data-token="/commit"]');
    expect(chip).toBeTruthy();
    // Sending yields the wire string with the token (trailing space trimmed).
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(mockSendPrompt).toHaveBeenCalledWith("s1", "/commit");
  });

  it("picks the active / row with Enter (keyboard nav wiring)", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(editor);
    fireEvent.keyDown(editor, { key: "/" });
    await screen.findByText("commit");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor.querySelector('.chip[data-token="/commit"]')).toBeTruthy();
  });

  it("moves the active row with arrows before Enter", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(editor);
    fireEvent.keyDown(editor, { key: "/" });
    await screen.findByText("commit");
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor.querySelector('.chip[data-token="/status"]')).toBeTruthy();
  });

  it("does not open a menu for / typed mid-text", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    typeInto(editor, "hi ");
    caretAtEnd(editor);
    fireEvent.keyDown(editor, { key: "/" });
    expect(screen.queryByText("Commands")).toBeNull();
  });
});
