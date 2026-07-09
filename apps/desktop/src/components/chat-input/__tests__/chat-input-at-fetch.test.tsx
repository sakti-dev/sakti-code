import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../chat-input";

const mockFilesGet = vi.fn();

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      sendPrompt: vi.fn(),
      replyPermission: vi.fn(),
    },
    sessions: {
      get: () => ({ store: { streaming: { phase: "idle" }, turns: [] } }),
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
                  commands: [{ name: "commit", description: "d" }],
                  skills: [],
                  agents: [],
                }),
              }),
            },
            files: {
              $get: mockFilesGet.mockReturnValue({
                ok: true,
                json: async () => ({ files: [] }),
              }),
            },
          },
        },
        models: {
          available: {
            $get: async () => ({ ok: false, json: async () => [] }),
            ":provider": { $get: async () => ({ ok: false, json: async () => [] }) },
          },
          connected: { $get: async () => ({ ok: false, json: async () => [] }) },
        },
      },
    },
  }),
}));

function caretAtStart(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function typeText(editor: HTMLElement, text: string) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(document.createTextNode(text));
  }
  fireEvent.input(editor);
}

afterEach(() => {
  cleanup();
  mockFilesGet.mockClear();
});

describe("ChatInput @ fetch", () => {
  it("fetches files for the @ query before a session exists (onboarding draft)", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;

    caretAtStart(editor);
    fireEvent.keyDown(editor, { key: "@" });
    typeText(editor, "src");

    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "src" },
      });
    });
  });

  it("lists files even for an empty @ query", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    fireEvent.keyDown(editor, { key: "@" });
    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "" },
      });
    });
  });

  it("resets the @ file query when reopening the menu", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;

    caretAtStart(editor);
    fireEvent.keyDown(editor, { key: "@" });
    typeText(editor, "src");
    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "src" },
      });
    });

    fireEvent.keyDown(editor, { key: "Escape" });
    mockFilesGet.mockClear();
    fireEvent.keyDown(editor, { key: "@" });

    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "" },
      });
    });
  });
});
