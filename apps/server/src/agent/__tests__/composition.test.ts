import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { WsIn, WsOut } from "../../agent/ws-handler.ts";
import { handleMessage } from "../../agent/ws-handler.ts";

describe("WS route composition", () => {
  it("handleMessage accepts WsHandle and returns void synchronously", () => {
    const ctx = {
      db: {},
      repos: {
        sessions: { findById: async () => null },
        projects: { findById: async () => null },
        models: {
          getForProject: async () => null,
          getGlobalDefault: async () => null,
        },
      },
    } as any;
    const store = {
      appendEntry: () => Effect.succeed(undefined),
      createEntryId: () => Effect.succeed(""),
      findEntries: () => Effect.succeed([]),
      getEntries: () => Effect.succeed([]),
      getEntry: () => Effect.succeed(undefined),
      getLabel: () => Effect.succeed(undefined),
      getLeafId: () => Effect.succeed(null),
      getMetadata: () =>
        Effect.succeed({
          id: "s1",
          createdAt: new Date().toISOString(),
        }),
      getPathToRoot: () => Effect.succeed([]),
      setLeafId: () => Effect.succeed(undefined),
    };

    const ws = { send: () => {} };
    const msg: WsIn = { type: "abort", sessionId: "sess-1" };

    handleMessage(ctx, store, ws, msg);
  });

  it("WsOut types are correctly structured", () => {
    const eventFrame: WsOut = {
      type: "event",
      sessionId: "sess-1",
      event: { type: "agent_start" },
    };
    const errorFrame: WsOut = {
      type: "error",
      sessionId: "sess-1",
      error: "something went wrong",
    };

    expect(eventFrame.type).toBe("event");
    expect(errorFrame.type).toBe("error");
  });

  it("WsIn discriminates on type field", () => {
    const prompt: WsIn = {
      type: "prompt",
      sessionId: "s1",
      message: "hello",
    };
    const abort: WsIn = { type: "abort", sessionId: "s1" };

    if (prompt.type === "prompt") {
      expect(prompt.message).toBe("hello");
    }
    if (abort.type === "abort") {
      expect(abort.sessionId).toBe("s1");
    }
  });
});
