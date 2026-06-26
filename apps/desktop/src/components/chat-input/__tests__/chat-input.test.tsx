import { fireEvent, render, screen } from "@solidjs/testing-library";
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
      store: { sessions: { s1: { modelId: "test-model", profileId: null } } },
    },
    api: {
      api: {
        auth: { $get: async () => ({ ok: false, json: async () => [] }) },
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
