import type { ServerEvent } from "@sakti-code/shared/event-types";
import { describe, expect, it } from "vitest";
import {
  applyDirectoryEvent,
  createInitialDirectoryStore,
  type DirectoryStore,
  type StoreUpdaterFunction,
} from "../helpers/event-handlers";

type EventFixture = {
  type: ServerEvent["type"];
  properties: ServerEvent["properties"];
  directory?: ServerEvent["directory"];
  sessionID?: ServerEvent["sessionID"];
  eventId?: ServerEvent["eventId"];
  sequence?: ServerEvent["sequence"];
  timestamp?: ServerEvent["timestamp"];
};

function createHarness(initial?: DirectoryStore) {
  let store = initial ? structuredClone(initial) : createInitialDirectoryStore();
  let nextSequence = 1;

  const normalizeEvent = (event: EventFixture): ServerEvent => {
    const sequence = typeof event.sequence === "number" ? event.sequence : nextSequence++;
    nextSequence = Math.max(nextSequence, sequence + 1);
    return {
      eventId: event.eventId ?? `test-event-${sequence}`,
      sequence,
      timestamp: event.timestamp ?? Date.now(),
      sessionID: event.sessionID,
      directory: event.directory,
      type: event.type,
      properties: event.properties,
    };
  };

  const setStore: StoreUpdaterFunction = (...args) => {
    const storeRecord = store as DirectoryStore & Record<string, unknown>;

    // Handle function argument (produce or reconcile)
    if (typeof args[0] === "function") {
      store = args[0](store);
      return;
    }

    if (typeof args[0] === "string") {
      const key = args[0];
      if (args.length === 2) {
        const value = args[1];
        if (typeof value === "function") {
          // setStore("key", produce(...) or reconcile(...))
          const current = storeRecord[key];
          storeRecord[key] = value(current);
        } else {
          // setStore("key", value)
          storeRecord[key] = value;
        }
      } else if (args.length === 3) {
        const second = args[1];
        const value = args[2];

        // Check if second arg is a number (array index) or string (object key)
        if (typeof second === "number") {
          // setStore("key", index, value) - array index update
          const arr = storeRecord[key] as unknown[];
          const index = second;
          if (Array.isArray(arr)) {
            if (typeof value === "function") {
              arr[index] = value(arr[index]);
            } else {
              arr[index] = value;
            }
          }
        } else {
          // setStore("key", messageID, value) - nested object update
          const topLevel = storeRecord[key];
          if (typeof second === "string") {
            if (!topLevel) {
              // Create the nested object with the value
              storeRecord[key] = { [second]: value };
            } else if (Array.isArray(topLevel)) {
              // topLevel is an array (e.g., store.session), second is index
              const index = Number.parseInt(second, 10);
              if (Number.isInteger(index) && index >= 0) {
                if (typeof value === "function") {
                  topLevel[index] = value(topLevel[index]);
                } else {
                  topLevel[index] = value;
                }
              }
            } else if (typeof topLevel === "object" && topLevel !== null) {
              // topLevel is an object (e.g., store.part, store.permission)
              // value might be a function (produce/reconcile) or a direct value
              const current = (topLevel as Record<string, unknown>)[second];
              if (typeof value === "function") {
                (topLevel as Record<string, unknown>)[second] = value(current);
              } else {
                (topLevel as Record<string, unknown>)[second] = value;
              }
            }
          }
        }
      } else if (args.length === 4) {
        // setStore("key", sessionID, index, value)
        const nested = storeRecord[key] as Record<string, unknown>;
        const sessionID = args[1] as string;
        const index = args[2] as number;
        const value = args[3];
        const arr = nested[sessionID] as unknown[];
        if (Array.isArray(arr)) {
          if (typeof value === "function") {
            arr[index] = value(arr[index]);
          } else {
            arr[index] = value;
          }
        }
      }
    } else {
      // Partial update (object with multiple keys)
      const partial = args[0] as Partial<DirectoryStore>;
      Object.assign(store, partial);
    }
  };

  return {
    apply(event: EventFixture) {
      applyDirectoryEvent({ event: normalizeEvent(event), store, setStore });
    },
    snapshot(): DirectoryStore {
      return structuredClone(store);
    },
    get store() {
      return store;
    },
  };
}

function assistantInfo(messageID: string, sessionID: string) {
  return {
    role: "assistant" as const,
    id: messageID,
    sessionID,
    time: { created: Date.now() },
  };
}

function textPart(partID: string, messageID: string, sessionID: string, text: string) {
  return {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text,
  };
}

describe("Parity Event Flows", () => {
  it("Scenario A: Pure text response", () => {
    const h = createHarness();
    h.apply({
      type: "message.updated",
      properties: { info: assistantInfo("msg-a", "s-a") },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: textPart("part-a", "msg-a", "s-a", "Hello from assistant"),
        delta: "Hello from assistant",
      },
    });

    expect(h.store.message["s-a"]).toHaveLength(1);
    expect(h.store.part["msg-a"]).toHaveLength(1);
    expect(h.store.part["msg-a"][0]?.type).toBe("text");
    expect(h.store.part["msg-a"][0]?.text).toBe("Hello from assistant");
  });

  it("Scenario B: Tool flow success", () => {
    const h = createHarness();
    const sessionID = "s-b";
    const messageID = "msg-b";
    const partID = "tool-b";

    h.apply({
      type: "message.updated",
      properties: { info: assistantInfo(messageID, sessionID) },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          sessionID,
          messageID,
          type: "tool",
          callID: "call-b",
          tool: "write_to_file",
          state: { status: "pending", input: {}, raw: "{}" },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          sessionID,
          messageID,
          type: "tool",
          callID: "call-b",
          tool: "write_to_file",
          state: { status: "running", input: {}, time: { start: Date.now() } },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: partID,
          sessionID,
          messageID,
          type: "tool",
          callID: "call-b",
          tool: "write_to_file",
          state: {
            status: "completed",
            input: {},
            output: "ok",
            title: "write_to_file",
            metadata: {},
            time: { start: Date.now() - 100, end: Date.now() },
          },
        },
      },
    });

    const parts = h.store.part[messageID] ?? [];
    expect(parts).toHaveLength(1);
    expect((parts[0] as { state?: { status?: string } }).state?.status).toBe("completed");
  });

  it("Scenario C: Tool flow denied permission", () => {
    const h = createHarness();
    const sessionID = "s-c";
    const messageID = "msg-c";
    const requestID = "perm-c";

    h.apply({
      type: "permission.asked",
      properties: {
        id: requestID,
        sessionID,
        permission: "write",
        patterns: ["src/file.ts"],
      },
    });

    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-c",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-c",
          tool: "write_to_file",
          state: {
            status: "error",
            input: {},
            error: "Permission denied",
            time: { start: Date.now() - 100, end: Date.now() },
          },
        },
      },
    });

    h.apply({
      type: "permission.replied",
      properties: {
        sessionID,
        requestID,
        reply: "reject",
      },
    });

    expect(h.store.permission[sessionID]).toHaveLength(0);
    const toolPart = (h.store.part[messageID] ?? [])[0] as {
      state?: { status?: string; error?: string };
    };
    expect(toolPart.state?.status).toBe("error");
    expect(toolPart.state?.error).toContain("Permission denied");
  });

  it("Scenario D: Reconnect/reload", () => {
    const h = createHarness();
    const event: EventFixture = {
      type: "message.part.updated",
      properties: {
        part: textPart("part-d", "msg-d", "s-d", "Persistent text"),
      },
    };

    h.apply({ type: "message.updated", properties: { info: assistantInfo("msg-d", "s-d") } });
    h.apply(event);
    const persisted = h.snapshot();

    const restored = createHarness(persisted);
    restored.apply(event);

    expect(restored.store.message["s-d"]).toHaveLength(1);
    expect(restored.store.part["msg-d"]).toHaveLength(1);
    expect(restored.store.part["msg-d"][0]?.text).toBe("Persistent text");
  });

  it("Scenario E: Interrupted stream", () => {
    const h = createHarness();
    const sessionID = "s-e";
    const messageID = "msg-e";

    h.apply({
      type: "session.status",
      properties: { sessionID, status: { type: "busy" } },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-e",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-e",
          tool: "run_command",
          state: { status: "running", input: {}, time: { start: Date.now() } },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-e",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-e",
          tool: "run_command",
          state: {
            status: "error",
            input: {},
            error: "Tool execution aborted",
            time: { start: Date.now() - 10, end: Date.now() },
          },
        },
      },
    });
    h.apply({
      type: "session.status",
      properties: { sessionID, status: { type: "idle" } },
    });

    expect(h.store.sessionStatus[sessionID]?.status.type).toBe("idle");
    const toolPart = (h.store.part[messageID] ?? [])[0] as { state?: { status?: string } };
    expect(toolPart.state?.status).toBe("error");
  });

  it("Scenario F: Multi-step reasoning", () => {
    const h = createHarness();
    const sessionID = "s-f";
    const messageID = "msg-f";

    h.apply({
      type: "message.updated",
      properties: { info: assistantInfo(messageID, sessionID) },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-f-start",
          sessionID,
          messageID,
          type: "step-start",
          snapshot: "snap-f-1",
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reason-f",
          sessionID,
          messageID,
          type: "reasoning",
          text: "Analyze context and choose tools",
          time: { start: Date.now() - 100, end: Date.now() },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-f-finish",
          sessionID,
          messageID,
          type: "step-finish",
          reason: "stop",
          snapshot: "snap-f-1",
          cost: 0.001,
          tokens: {
            input: 100,
            output: 40,
            reasoning: 20,
            cache: { read: 0, write: 0 },
          },
        },
      },
    });

    const parts = h.store.part[messageID] ?? [];
    expect(parts.some(part => part.type === "step-start")).toBe(true);
    expect(parts.some(part => part.type === "reasoning")).toBe(true);
    expect(parts.some(part => part.type === "step-finish")).toBe(true);
  });

  it("Scenario G: File operations", () => {
    const h = createHarness();
    const sessionID = "s-g";
    const messageID = "msg-g";

    h.apply({
      type: "message.updated",
      properties: { info: assistantInfo(messageID, sessionID) },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "snapshot-g",
          sessionID,
          messageID,
          type: "snapshot",
          snapshot: "src/app.ts\nline 1\nline 2",
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "patch-g",
          sessionID,
          messageID,
          type: "patch",
          hash: "abc123",
          files: ["diff --git a/src/app.ts b/src/app.ts", "+console.log('ok')"],
        },
      },
    });

    const parts = h.store.part[messageID] ?? [];
    expect(parts.some(part => part.type === "snapshot")).toBe(true);
    expect(parts.some(part => part.type === "patch")).toBe(true);
  });

  it("Scenario H: Multiple concurrent tools", () => {
    const h = createHarness();
    const sessionID = "s-h";
    const messageID = "msg-h";

    h.apply({
      type: "message.updated",
      properties: { info: assistantInfo(messageID, sessionID) },
    });

    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-h-1",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-h-1",
          tool: "read_file",
          state: { status: "running", input: {}, time: { start: Date.now() - 50 } },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-h-2",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-h-2",
          tool: "run_command",
          state: { status: "running", input: {}, time: { start: Date.now() - 40 } },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-h-1",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-h-1",
          tool: "read_file",
          state: {
            status: "completed",
            input: {},
            output: "content",
            title: "read_file",
            metadata: {},
            time: { start: Date.now() - 50, end: Date.now() - 20 },
          },
        },
      },
    });
    h.apply({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-h-2",
          sessionID,
          messageID,
          type: "tool",
          callID: "call-h-2",
          tool: "run_command",
          state: {
            status: "completed",
            input: {},
            output: "ok",
            title: "run_command",
            metadata: {},
            time: { start: Date.now() - 40, end: Date.now() - 10 },
          },
        },
      },
    });

    const parts = h.store.part[messageID] ?? [];
    const toolOne = parts.find(part => part.id === "tool-h-1") as
      | { state?: { status?: string } }
      | undefined;
    const toolTwo = parts.find(part => part.id === "tool-h-2") as
      | { state?: { status?: string } }
      | undefined;
    expect(toolOne?.state?.status).toBe("completed");
    expect(toolTwo?.state?.status).toBe("completed");
  });
});
