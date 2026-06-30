import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { WsIn } from "@sakti-code/server/ws";
import { describe, expect, it } from "vite-plus/test";

describe("type imports", () => {
  it("can reference agent types", () => {
    const event: AgentHarnessEvent = { type: "agent_start" };
    expect(event.type).toBe("agent_start");
  });

  it("can reference WS types", () => {
    const msg: WsIn = { type: "abort", sessionId: "s1" };
    expect(msg.type).toBe("abort");
  });
});
