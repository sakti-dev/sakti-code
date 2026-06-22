import { describe, expect, it } from "vitest";
import {
  hasWsConnection,
  pushToConnection,
  registerTestConnection,
  unregisterTestConnection,
} from "../agent/ws.ts";

describe("terminal push channels (real pushToConnection path)", () => {
  it("C3: a push to a registered connection delivers the exact frame JSON", () => {
    const received: unknown[] = [];
    registerTestConnection("conn-1", {
      send: (d: unknown) => received.push(d),
    });

    pushToConnection("conn-1", {
      type: "push",
      channel: "terminal.data",
      data: { terminalId: "t1", data: "hello\n" },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: "push",
      channel: "terminal.data",
      data: { terminalId: "t1", data: "hello\n" },
    });

    unregisterTestConnection("conn-1");
  });

  it("C3: a push to an unknown connection is silently dropped (no throw)", () => {
    expect(() => {
      pushToConnection("does-not-exist", {
        type: "push",
        channel: "terminal.data",
        data: { terminalId: "t1", data: "x" },
      });
    }).not.toThrow();
  });

  it("C3: hasWsConnection reflects registration lifecycle", () => {
    expect(hasWsConnection("conn-2")).toBe(false);
    registerTestConnection("conn-2", { send: () => {} });
    expect(hasWsConnection("conn-2")).toBe(true);
    unregisterTestConnection("conn-2");
    expect(hasWsConnection("conn-2")).toBe(false);
  });

  it("C3: terminal.exit push includes signal when provided, omits when undefined", () => {
    const received: unknown[] = [];
    registerTestConnection("conn-3", {
      send: (d: unknown) => received.push(d),
    });

    pushToConnection("conn-3", {
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t1", exitCode: 9, signal: 9 },
    });
    pushToConnection("conn-3", {
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t2", exitCode: 0 },
    });

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t1", exitCode: 9, signal: 9 },
    });
    expect(
      "signal" in (received[1] as { data: Record<string, unknown> }).data
    ).toBe(false);

    unregisterTestConnection("conn-3");
  });
});
