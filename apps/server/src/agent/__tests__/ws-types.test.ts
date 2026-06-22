import { describe, expect, it } from "vitest";
import type { WsIn, WsOut } from "../ws-handler.ts";

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
});
