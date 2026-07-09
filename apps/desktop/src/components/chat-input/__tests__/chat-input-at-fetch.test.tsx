import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
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

afterEach(() => {
  cleanup();
  mockFilesGet.mockClear();
});

describe("ChatInput @ fetch", () => {
  it("fetches files for the @ query before a session exists (onboarding draft)", async () => {
    // The onboarding/plan-chat view renders ChatInput with sessionId=null
    // until the first send (sessions are created lazily to avoid dangling
    // ones). The @ search must still resolve the project from the store's
    // activeProjectId and fetch files for the typed query.
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;

    fireEvent.keyDown(editor, { key: "@" });

    const input = await screen.findByRole("combobox");
    await userEvent.type(input, "src");

    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "src" },
      });
    });
  });
});
