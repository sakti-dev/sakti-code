import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "../chat-input";

const mockSendPrompt = vi.fn();
const mockGet = vi.fn(() => ({
  store: { streaming: { phase: "idle" }, messages: {}, messageOrder: [] },
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: { sendPrompt: mockSendPrompt },
    sessions: { get: mockGet },
    server: { store: { sessions: {} } },
    api: {
      api: { models: { available: { $get: async () => ({ ok: false }) } } },
    },
  }),
}));

describe("ChatInput", () => {
  it("renders textarea with placeholder", () => {
    const { getByPlaceholderText } = render(() => (
      <ChatInput placeholder="Type here…" sessionId="s1" />
    ));
    expect(getByPlaceholderText("Type here…")).toBeTruthy();
  });

  it("disables input when sessionId is null", () => {
    const { getByRole } = render(() => <ChatInput sessionId={null} />);
    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("sends message on Enter, clears input", () => {
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
});
