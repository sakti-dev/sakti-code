import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../chat-input";

const mockHistoryGet = vi.fn();

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: { sendPrompt: vi.fn(), replyPermission: vi.fn() },
    sessions: { get: () => ({ store: { streaming: { phase: "idle" }, turns: [] } }) },
    server: {
      store: {
        activeProjectId: "proj1",
        sessions: {},
        projects: {
          proj1: { id: "proj1", name: "P", cwd: "/tmp/p", createdAt: 0, updatedAt: 0 },
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
                json: async () => ({ commands: [], skills: [], agents: [] }),
              }),
            },
            files: { $get: async () => ({ ok: true, json: async () => ({ files: [] }) }) },
            "prompt-history": { $get: mockHistoryGet },
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

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  mockHistoryGet.mockReturnValue({
    ok: true,
    json: async () => ({ prompts: ["newest", "older"] }),
  });
});
afterEach(() => {
  cleanup();
  mockHistoryGet.mockReset();
});

describe("ChatInput prompt history", () => {
  it("ArrowUp recalls newest, then older; ArrowDown goes forward", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    await waitFor(() => {
      expect(mockHistoryGet).toHaveBeenCalled();
    });
    await flush();

    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(ed.textContent).toBe("newest");
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(ed.textContent).toBe("older");
    fireEvent.keyDown(ed, { key: "ArrowDown" });
    expect(ed.textContent).toBe("newest");
  });

  it("ArrowDown past newest restores the draft", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    await waitFor(() => {
      expect(mockHistoryGet).toHaveBeenCalled();
    });
    await flush();

    ed.focus();
    ed.textContent = "my draft";
    fireEvent.input(ed);
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(ed.textContent).toBe("newest");
    fireEvent.keyDown(ed, { key: "ArrowDown" });
    expect(ed.textContent).toBe("my draft");
  });
});
