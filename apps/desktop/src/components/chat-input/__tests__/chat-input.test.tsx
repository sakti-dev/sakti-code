import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../chat-input";
import type { ContextMenuMode } from "../context-menu";

const mockSendPrompt = vi.fn();
const mockReplyPermission = vi.fn();
const mockSessionStore = {
  current: {
    streaming: { phase: "idle" },
    messages: {},
    messageOrder: [],
  } as Record<string, unknown>,
};

// Stub the ContextMenu so these tests verify ChatInput's *wiring* (trigger →
// open, pick → insertChip, close → refocus) without dragging Kobalte's modal
// Dialog into jsdom (its dynamic open focus-trap is flaky across repeated
// opens). The real menu component is covered by context-menu.test.tsx.
// Stub the ContextMenu so these tests verify ChatInput's *wiring* (trigger →
// open, pick → insertChip, close → refocus) without dragging Kobalte's modal
// Dialog into jsdom (its dynamic open focus-trap is flaky across repeated
// opens). The real menu component is covered by context-menu.test.tsx.
//
// NOTE: the open-conditional is a JSX child ternary (not an early return) so
// Solid reactively shows/hides content — a component body runs only once, so
// `if (!open) return null` would never re-render when `open` later flips true.
vi.mock("../context-menu", () => ({
  ContextMenu: (props: {
    open: boolean;
    mode: ContextMenuMode;
    commands: { name: string }[];
    onClose: () => void;
    onPick: (token: string) => void;
  }) => (
    <div data-testid="ctx-menu">
      {props.open ? (
        <>
          <div>{props.mode === "/" ? "Commands & Skills" : "Files"}</div>
          {/* biome-ignore lint/performance/useSolidForComponent: test stub */}
          {props.commands.map((c) => (
            <button
              data-token={`/${c.name}`}
              onClick={() => {
                props.onPick(`/${c.name}`);
                props.onClose();
              }}
              type="button"
            >
              {c.name}
            </button>
          ))}
        </>
      ) : null}
    </div>
  ),
}));

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

afterEach(() => {
  cleanup();
  mockSessionStore.current = {
    streaming: { phase: "idle" },
    messages: {},
    messageOrder: [],
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
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(mockReplyPermission).toHaveBeenCalledWith("s1", "per_1", "once");
  });
});

describe("ChatInput context menus", () => {
  it("opens the / menu when / is typed at the editor start", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    fireEvent.keyDown(editor, { key: "/" });
    expect(await screen.findByText("Commands & Skills")).toBeTruthy();
  });

  it("opens the @ menu when @ is typed mid-text", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    typeInto(editor, "see ");
    fireEvent.keyDown(editor, { key: "@" });
    expect(await screen.findByText("Files")).toBeTruthy();
  });

  it("inserts the picked token as a chip and refocuses on close (/ mode)", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    // Picking closes the menu → closeMenu refocuses the editor. jsdom won't
    // move activeElement to a contenteditable div, so assert the wiring: the
    // editor's focus() is invoked on close.
    const focusSpy = vi.spyOn(editor, "focus");
    fireEvent.keyDown(editor, { key: "/" });
    const item = await screen.findByText("commit");
    fireEvent.click(item);
    const chip = editor.querySelector('.chip[data-token="/commit"]');
    expect(chip).toBeTruthy();
    await waitFor(() => {
      expect(focusSpy).toHaveBeenCalled();
    });
    // Sending yields the wire string with the token.
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(mockSendPrompt).toHaveBeenCalledWith("s1", "/commit");
  });

  it("does not open a menu for / typed mid-text", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    typeInto(editor, "hi ");
    fireEvent.keyDown(editor, { key: "/" });
    expect(screen.queryByText("Commands & Skills")).toBeNull();
  });
});
