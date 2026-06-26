import { describe, expect, it } from "vitest";
import { createPermissionChannel } from "../permission-channel.ts";

describe("permission channel", () => {
  it("asks, then resolves allow on 'once' without persisting a grant", async () => {
    const asked: Array<{ id: string; permission: string; patterns: string[] }> =
      [];
    const ch = createPermissionChannel({
      onAsked: (frame) => asked.push(frame),
    });
    const p = ch.ask({
      sessionId: "s1",
      permission: "read",
      patterns: ["a.env"],
      always: ["a.env"],
      toolName: "read",
      toolCallId: "c1",
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      sessionId: "s1",
      permission: "read",
      patterns: ["a.env"],
      toolName: "read",
      toolCallId: "c1",
    });
    ch.reply("s1", asked[0]!.id, "once");
    expect(await p).toBe("allow");

    // no grant persisted: a second ask for the same pattern asks again
    const p2 = ch.ask({
      sessionId: "s1",
      permission: "read",
      patterns: ["a.env"],
      always: ["a.env"],
      toolName: "read",
      toolCallId: "c2",
    });
    expect(asked).toHaveLength(2);
    ch.reply("s1", asked[1]!.id, "reject");
    expect(await p2).toBe("deny");
  });

  it("'always' persists a grant so the next matching ask auto-allows (no frame)", async () => {
    const asked: Array<{ id: string }> = [];
    const ch = createPermissionChannel({
      onAsked: (frame) => asked.push(frame),
    });
    const p = ch.ask({
      sessionId: "s1",
      permission: "read",
      patterns: ["*.env"],
      always: ["*.env"],
      toolName: "read",
      toolCallId: "c1",
    });
    ch.reply("s1", asked[0]!.id, "always");
    expect(await p).toBe("allow");

    const p2 = ch.ask({
      sessionId: "s1",
      permission: "read",
      patterns: ["x.env"],
      always: ["x.env"],
      toolName: "read",
      toolCallId: "c2",
    });
    expect(asked).toHaveLength(1); // no new frame — grant covered it
    expect(await p2).toBe("allow");
  });

  it("'reject' resolves deny", async () => {
    const ch = createPermissionChannel({ onAsked: () => {} });
    const p = ch.ask({
      sessionId: "s1",
      permission: "read",
      patterns: ["a"],
      always: ["a"],
      toolName: "read",
      toolCallId: "c1",
    });
    // find the id via the pending list
    const pending = ch.listPending("s1");
    ch.reply("s1", pending[0]!.id, "reject");
    expect(await p).toBe("deny");
  });

  it("rejectPendingForSession denies all pending for that session", async () => {
    const ch = createPermissionChannel({ onAsked: () => {} });
    const p = ch.ask({
      sessionId: "s1",
      permission: "read",
      patterns: ["a"],
      always: ["a"],
      toolName: "read",
      toolCallId: "c1",
    });
    ch.rejectPendingForSession("s1");
    expect(await p).toBe("deny");
    expect(ch.listPending("s1")).toHaveLength(0);
  });

  it("ignores a reply for an unknown id (stale)", async () => {
    const ch = createPermissionChannel({ onAsked: () => {} });
    expect(() => ch.reply("s1", "nope", "once")).not.toThrow();
  });
});
