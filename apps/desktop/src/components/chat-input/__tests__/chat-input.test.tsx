import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../chat-input";

const mockSendPrompt = vi.fn();
const mockReplyPermission = vi.fn();
const mockSessionStore = {
  current: {
    streaming: { phase: "idle" },
    messages: {},
    messageOrder: [],
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
        projects: {
          ":id": {
            context: {
              $get: async () => ({
                ok: true,
                json: async () => ({
                  commands: [{ name: "commit", description: "d" }],
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

describe("ChatInput", () => {
  afterEach(() => {
    mockSessionStore.current = {
      streaming: { phase: "idle" },
      messages: {},
      messageOrder: [],
    };
    mockSendPrompt.mockClear();
    mockReplyPermission.mockClear();
  });

  it("renders textarea with placeholder", () => {
    const { getByPlaceholderText } = render(() => (
      <ChatInput placeholder="Type here…" sessionId="s1" />
    ));
    expect(getByPlaceholderText("Type here…")).toBeTruthy();
  });

  it("keeps input enabled when sessionId is null", () => {
    const { getByRole } = render(() => <ChatInput sessionId={null} />);
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it("sends message on Enter, clears input", () => {
    mockSendPrompt.mockClear();
    const { getByRole } = render(() => <ChatInput sessionId="s1" />);
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    textarea.value = "hello world";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockSendPrompt).toHaveBeenCalledWith("s1", "hello world");
    expect(textarea.value).toBe("");
  });

  it("does not send on Shift+Enter", () => {
    mockSendPrompt.mockClear();
    const { getByRole } = render(() => <ChatInput sessionId="s1" />);
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    textarea.value = "line break";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mockSendPrompt).not.toHaveBeenCalled();
  });

  it("does not send when empty", () => {
    mockSendPrompt.mockClear();
    const { getByRole } = render(() => <ChatInput sessionId="s1" />);
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockSendPrompt).not.toHaveBeenCalled();
  });

  it("renders the permission strip and wires replyPermission when a request is pending", async () => {
    mockSessionStore.current = {
      streaming: { phase: "idle" },
      messages: {},
      messageOrder: [],
      permission: {
        id: "per_1",
        permission: "read",
        patterns: ["secret.env"],
        toolName: "read",
        toolCallId: "c1",
      },
    };
    render(() => <ChatInput sessionId="s1" />);
    await fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(mockReplyPermission).toHaveBeenCalledWith("s1", "per_1", "once");
  });
});

describe("ChatInput context menus", () => {
  it("opens the / menu when / is typed at caret 0", async () => {
    const { getByPlaceholderText } = render(() => (
      <ChatInput placeholder="p" sessionId="s1" />
    ));
    const textarea = getByPlaceholderText("p") as HTMLTextAreaElement;
    textarea.value = "/";
    textarea.setSelectionRange(1, 1);
    fireEvent.input(textarea);
    await waitFor(() => {
      expect(screen.getByText("Commands & Skills")).toBeTruthy();
    });
  });

  it("opens the @ menu when @ is typed mid-text", async () => {
    const { getByPlaceholderText } = render(() => (
      <ChatInput placeholder="p" sessionId="s1" />
    ));
    const textarea = getByPlaceholderText("p") as HTMLTextAreaElement;
    textarea.value = "see @";
    textarea.setSelectionRange(5, 5);
    fireEvent.input(textarea);
    await waitFor(() => {
      expect(screen.getByText("Files")).toBeTruthy();
    });
  });

  it("inserts the picked token into the textarea (/ mode)", async () => {
    const { getByPlaceholderText } = render(() => (
      <ChatInput placeholder="p" sessionId="s1" />
    ));
    const textarea = getByPlaceholderText("p") as HTMLTextAreaElement;
    textarea.value = "/";
    textarea.setSelectionRange(1, 1);
    fireEvent.input(textarea);
    await waitFor(() => {
      expect(screen.getByText("commit")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("commit"));
    expect(textarea.value).toBe("/commit ");
  });

  it("does not open a menu for / typed mid-text", async () => {
    const { getByPlaceholderText } = render(() => (
      <ChatInput placeholder="p" sessionId="s1" />
    ));
    const textarea = getByPlaceholderText("p") as HTMLTextAreaElement;
    textarea.value = "hi /";
    textarea.setSelectionRange(4, 4);
    fireEvent.input(textarea);
    expect(screen.queryByText("Commands & Skills")).toBeNull();
  });
});

it("refocuses the textarea when the menu closes via Escape", async () => {
  const { getByPlaceholderText } = render(() => (
    <ChatInput placeholder="p" sessionId="s1" />
  ));
  const textarea = getByPlaceholderText("p") as HTMLTextAreaElement;
  textarea.value = "/";
  textarea.setSelectionRange(1, 1);
  fireEvent.input(textarea);
  await waitFor(() => {
    expect(screen.getByText("Commands & Skills")).toBeTruthy();
  });
  const input = document.querySelector("[cmdk-input]") as HTMLInputElement;
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => {
    expect(document.activeElement).toBe(textarea);
  });
});
