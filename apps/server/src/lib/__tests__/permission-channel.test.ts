import { describe, expect, it } from "vite-plus/test";
import {
  createPermissionChannel,
  getPermissionChannel,
  resetPermissionChannelsForTesting,
} from "../permission-channel.ts";

describe("permission channel", () => {
  it("asks, then resolves allow on 'once' without persisting a grant", async () => {
    const asked: Array<{ id: string; permission: string; patterns: string[] }> = [];
    const ch = createPermissionChannel();
    ch.setSink((frame) => asked.push(frame));
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
    ch.reply(asked[0]!.id, "once");
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
    ch.reply(asked[1]!.id, "reject");
    expect(await p2).toBe("deny");
  });

  it("'always' persists a grant so the next matching ask auto-allows (no frame)", async () => {
    const asked: Array<{ id: string }> = [];
    const ch = createPermissionChannel();
    ch.setSink((frame) => asked.push(frame));
    const p = ch.ask({
      sessionId: "s2",
      permission: "read",
      patterns: ["*.env"],
      always: ["*.env"],
      toolName: "read",
      toolCallId: "c1",
    });
    ch.reply(asked[0]!.id, "always");
    expect(await p).toBe("allow");

    const p2 = ch.ask({
      sessionId: "s2",
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
    const ch = createPermissionChannel();
    ch.setSink(() => {});
    const p = ch.ask({
      sessionId: "s3",
      permission: "read",
      patterns: ["a"],
      always: ["a"],
      toolName: "read",
      toolCallId: "c1",
    });
    ch.reply(ch.listPending()[0]!.id, "reject");
    expect(await p).toBe("deny");
  });

  it("rejectPending denies all pending", async () => {
    const ch = createPermissionChannel();
    ch.setSink(() => {});
    const p = ch.ask({
      sessionId: "s4",
      permission: "read",
      patterns: ["a"],
      always: ["a"],
      toolName: "read",
      toolCallId: "c1",
    });
    ch.rejectPending();
    expect(await p).toBe("deny");
    expect(ch.listPending()).toHaveLength(0);
  });

  it("ignores a reply for an unknown id (stale)", async () => {
    const ch = createPermissionChannel();
    expect(() => ch.reply("nope", "once")).not.toThrow();
  });

  it("evaluate merges grants into the base ruleset", () => {
    const ch = createPermissionChannel();
    // base ruleset denies *.env; with no grant, evaluate -> deny
    const base = [{ permission: "read", pattern: "*.env", action: "deny" as const }];
    expect(ch.evaluate("read", "a.env", base)).toBe("deny");
    expect(ch.evaluate("read", "a.ts", [])).toBe("ask"); // nothing matches -> ask
  });
});

describe("permission channel registry", () => {
  it("getPermissionChannel returns a stable per-session channel", () => {
    resetPermissionChannelsForTesting();
    const a = getPermissionChannel("sess-x");
    const b = getPermissionChannel("sess-x");
    const c = getPermissionChannel("sess-y");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
