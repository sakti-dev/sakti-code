// @vitest-environment jsdom

import type { Part as CorePart, Message } from "@ekacode/core/chat";
import { render } from "solid-js/web";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Part } from "../../src/components/message-part";
import { registerDefaultPartComponents } from "../../src/components/parts/register";

// Mock environment to be in test mode for throttling bypass
vi.mock("../../src/components/parts/text-part", async importOriginal => {
  const mod = await importOriginal<typeof import("../../src/components/parts/text-part")>();
  return {
    ...mod,
    TEXT_RENDER_THROTTLE_MS: 0,
  };
});

type RenderHandle = {
  container: HTMLDivElement;
  dispose: () => void;
};

const disposers: Array<() => void> = [];

beforeAll(() => {
  registerDefaultPartComponents();
});

afterEach(() => {
  while (disposers.length > 0) {
    const dispose = disposers.pop();
    dispose?.();
  }
  document.body.innerHTML = "";
});

function messageFor(id: string): Message {
  return {
    info: {
      role: "assistant",
      id,
      sessionID: "session-1",
      time: { created: 1 },
    },
    parts: [],
  };
}

function renderPart(part: CorePart): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => <Part part={part} message={messageFor(part.messageID)} />,
    container
  );
  disposers.push(dispose);
  return { container, dispose };
}

describe("Part Rendering", () => {
  it("renders text part content", async () => {
    const { container } = renderPart({
      id: "part-text",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "text",
      text: "Hello world",
    });

    expect(container.querySelector('[data-component="text-part"]')).not.toBeNull();
    // Wait for Markdown async resource to load and DOM to update
    await new Promise(resolve => setTimeout(resolve, 150));
    // The markdown component renders a p tag inside, check for that
    const markdownDiv = container.querySelector('[data-component="markdown"]');
    expect(markdownDiv).not.toBeNull();
    expect(markdownDiv?.textContent?.trim()).toBe("Hello world");
  });

  it("renders tool part pending state", () => {
    const { container } = renderPart({
      id: "part-tool-pending",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-1",
      tool: "write_file",
      state: {
        status: "pending",
        input: { path: "src/app.ts" },
        raw: '{"path":"src/app.ts"}',
      },
    });

    expect(container.querySelector('[data-component="tool-pending"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-title"]')?.textContent).toContain(
      "Write File"
    );
  });

  it("renders tool part completed and toggles output", () => {
    const { container } = renderPart({
      id: "part-tool-completed",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "echo ok" },
        output: "ok",
        title: "bash",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    });

    expect(container.querySelector('[data-component="tool-completed"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-output"]')).toBeNull();

    (container.querySelector('[data-slot="tool-header"]') as HTMLElement).click();
    expect(container.querySelector('[data-slot="tool-output"]')?.textContent).toContain("ok");
  });

  it("renders reasoning part and toggles collapse", () => {
    const { container } = renderPart({
      id: "part-reason",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "reasoning",
      text: "Thinking about implementation",
      time: { start: 1, end: 2001 },
    });

    expect(container.querySelector('[data-component="reasoning-part"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="reasoning-content"]')?.textContent).toContain(
      "Thinking about implementation"
    );

    (container.querySelector('[data-slot="reasoning-header"]') as HTMLElement).click();
    expect(container.querySelector('[data-slot="reasoning-content"]')).toBeNull();
  });

  it("renders file part attachment", () => {
    const { container } = renderPart({
      id: "part-file",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "file",
      mime: "text/plain",
      filename: "notes.txt",
      url: "https://example.com/notes.txt",
    });

    expect(container.querySelector('[data-component="file-part"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="file-name"]')?.textContent).toContain("notes.txt");
  });

  it("renders error part message", () => {
    const { container } = renderPart({
      id: "part-error",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "error",
      message: "Something went wrong",
      details: "Stack trace...",
    });

    expect(container.querySelector('[data-component="error-part"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="error-message"]')?.textContent).toContain(
      "Something went wrong"
    );
  });

  it("renders snapshot part with line count", () => {
    const { container } = renderPart({
      id: "part-snapshot",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "snapshot",
      snapshot: "line1\nline2\nline3",
    });

    expect(container.querySelector('[data-component="snapshot-part"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="snapshot-stats"]')?.textContent).toContain(
      "3 lines"
    );
  });

  it("renders patch part with headers and diff lines", () => {
    const { container } = renderPart({
      id: "part-patch",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "patch",
      hash: "abcdef123456",
      files: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "-old line",
        "+new line",
      ],
    });

    expect(container.querySelector('[data-component="patch-part"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="patch-hash"]')?.textContent).toContain("abcdef12");
    expect(container.querySelector('[data-line-type="add"]')?.textContent).toContain("+new line");
    expect(container.querySelector('[data-line-type="remove"]')?.textContent).toContain(
      "-old line"
    );
  });

  it("renders step-start and step-finish stats", () => {
    const start = renderPart({
      id: "part-step-start",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "step-start",
      snapshot: "snapshot-1",
    });
    expect(start.container.querySelector('[data-component="step-start-part"]')).not.toBeNull();
    expect(
      start.container.querySelector('[data-slot="step-start-snapshot"]')?.textContent
    ).toContain("snapshot-1");

    const finish = renderPart({
      id: "part-step-finish",
      sessionID: "session-1",
      messageID: "msg-2",
      type: "step-finish",
      reason: "stop",
      snapshot: "snapshot-2",
      cost: 0.015,
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 200,
        cache: { read: 300, write: 100 },
      },
    });
    expect(finish.container.querySelector('[data-component="step-finish-part"]')).not.toBeNull();
    expect(finish.container.querySelector('[data-slot="step-finish-cost"]')?.textContent).toContain(
      "$0.0150"
    );
    expect(finish.container.querySelector('[data-slot="stat-input"]')?.textContent).toContain(
      "1.0K"
    );
  });

  it("renders nothing for unknown part type", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Part
          part={
            {
              id: "unknown",
              sessionID: "session-1",
              messageID: "msg-1",
              type: "unknown-part",
            } as unknown as CorePart
          }
          message={messageFor("msg-1")}
        />
      ),
      container
    );
    disposers.push(dispose);

    expect(container.innerHTML.trim()).toBe("");
  });
});
