import { Compile } from "typebox/compile";
import { describe, expect, it } from "vite-plus/test";
import type { WsIn, WsOut } from "../ws-handler.ts";
import { wsResponseSchema } from "../ws-handler.ts";

describe("WS frame types", () => {
  it("WsIn accepts prompt message", () => {
    const msg: WsIn = { type: "prompt", sessionId: "s1", message: "hello" };
    expect(msg.type).toBe("prompt");
  });

  it("WsOut includes event, error, welcome, and push frames", () => {
    const frames: WsOut[] = [
      {
        type: "event",
        sessionId: "s1",
        event: { type: "agent_start" } as never,
      },
      { type: "error", sessionId: "s1", error: "boom" },
      { type: "welcome", version: "1.0.0", cwd: "/tmp" },
      {
        type: "push",
        channel: "terminal.data",
        data: { terminalId: "t1", data: "ls" },
      },
    ];
    expect(frames).toHaveLength(4);
  });

  it("WsIn accepts permission.reply and WsOut includes asked/replied frames", () => {
    const msg: WsIn = {
      type: "permission.reply",
      sessionId: "s1",
      id: "per_1",
      reply: "always",
    };
    expect(msg.type).toBe("permission.reply");
    const out: WsOut[] = [
      {
        type: "permission.asked",
        sessionId: "s1",
        id: "per_1",
        permission: "read",
        patterns: ["a.env"],
        toolName: "read",
        toolCallId: "c1",
      },
      {
        type: "permission.replied",
        sessionId: "s1",
        id: "per_1",
        reply: "always",
      },
    ];
    expect(out).toHaveLength(2);
  });

  it("WsOut includes transition_resolved frame for gate and auto modes", () => {
    const frames: WsOut[] = [
      {
        type: "transition_resolved",
        sessionId: "s1",
        to: "build",
        mode: "gate",
        status: "specify",
        body: "spec summary",
      },
      {
        type: "transition_resolved",
        sessionId: "s1",
        to: "verify",
        mode: "auto",
        status: "verify",
      },
    ];
    expect(frames).toHaveLength(2);
  });

  it("wsResponseSchema validates transition_resolved frames", () => {
    const checker = Compile(wsResponseSchema);
    const gateFrame = {
      type: "transition_resolved",
      sessionId: "s1",
      to: "build",
      mode: "gate",
      status: "specify",
      body: "spec summary",
    };
    const autoFrame = {
      type: "transition_resolved",
      sessionId: "s1",
      to: "verify",
      mode: "auto",
      status: "verify",
    };
    expect(checker.Check(gateFrame)).toBe(true);
    expect(checker.Check(autoFrame)).toBe(true);
  });
});
