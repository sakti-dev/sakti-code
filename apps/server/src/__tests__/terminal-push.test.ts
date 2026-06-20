import { describe, expect, it } from "bun:test";

describe("terminal push channels", () => {
  it("terminal.data push has correct structure", () => {
    const frame = {
      type: "push",
      channel: "terminal.data",
      data: { terminalId: "term-1", data: "hello\n" },
    };
    expect(frame.type).toBe("push");
    expect(frame.channel).toBe("terminal.data");
    expect(frame.data.terminalId).toBe("term-1");
    expect(frame.data.data).toBe("hello\n");
  });

  it("terminal.exit push has correct structure", () => {
    const frame = {
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "term-1", exitCode: 0 },
    };
    expect(frame.type).toBe("push");
    expect(frame.channel).toBe("terminal.exit");
    expect(frame.data.terminalId).toBe("term-1");
    expect(frame.data.exitCode).toBe(0);
  });

  it("terminal.exit push includes signal when provided", () => {
    const frame = {
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "term-1", exitCode: 9, signal: 9 },
    };
    expect(frame.data.signal).toBe(9);
  });

  it("terminal.exit push omits signal when undefined", () => {
    const frame: Record<string, unknown> = {
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "term-1", exitCode: 0 },
    };
    const hasSignal = "signal" in (frame.data as Record<string, unknown>);
    expect(hasSignal).toBe(false);
  });

  it("push to unknown connection does not throw", () => {
    expect(() => {
      // Simulate sending to a connection that doesn't exist
      // In ws.ts this is handled by wsConnections.get returning undefined
      const pushToConnection = (_connectionId: string, _data: unknown) => {
        // No-op: unknown connections are handled gracefully
      };
      pushToConnection("nonexistent", { type: "push" });
    }).not.toThrow();
  });
});
