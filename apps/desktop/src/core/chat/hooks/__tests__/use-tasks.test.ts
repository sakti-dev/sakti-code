// @vitest-environment jsdom
import { useTasks } from "@/core/chat/hooks/use-tasks";
import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("useTasks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes tasks when the active session changes", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/agent-tasks/session-1")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [{ id: "t1", title: "S1 Task", status: "open", priority: 2 }],
              hasMore: false,
              total: 1,
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/api/agent-tasks/session-2")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [{ id: "t2", title: "S2 Task", status: "in_progress", priority: 1 }],
              hasMore: false,
              total: 1,
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ tasks: [], hasMore: false, total: 0 }), { status: 200 })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createRoot(async dispose => {
      const [sessionId, setSessionId] = createSignal("session-1");
      const hook = useTasks(sessionId);
      hook.startListening();
      await flushMicrotasks();

      expect(hook.tasks()).toEqual([{ id: "t1", title: "S1 Task", status: "open", priority: 2 }]);

      setSessionId("session-2");
      await flushMicrotasks();

      expect(hook.tasks()).toEqual([
        { id: "t2", title: "S2 Task", status: "in_progress", priority: 1 },
      ]);
      expect(fetchMock).toHaveBeenCalledWith("/api/agent-tasks/session-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/agent-tasks/session-2");
      dispose();
    });
  });

  it("handles task.updated events for the current session only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ tasks: [], hasMore: false, total: 0 }), { status: 200 })
        )
      )
    );

    await createRoot(async dispose => {
      const [sessionId] = createSignal("session-live");
      const hook = useTasks(sessionId);
      hook.startListening();
      await flushMicrotasks();

      window.dispatchEvent(
        new CustomEvent("sakti-code:task.updated", {
          detail: {
            sessionId: "other-session",
            tasks: [{ id: "ignore", title: "Ignore", status: "open", priority: 2 }],
          },
        })
      );
      expect(hook.tasks()).toEqual([]);

      window.dispatchEvent(
        new CustomEvent("sakti-code:task.updated", {
          detail: {
            sessionId: "session-live",
            tasks: [{ id: "apply", title: "Apply", status: "in_progress", priority: 1 }],
          },
        })
      );

      expect(hook.tasks()).toEqual([
        { id: "apply", title: "Apply", status: "in_progress", priority: 1 },
      ]);
      dispose();
    });
  });
});
