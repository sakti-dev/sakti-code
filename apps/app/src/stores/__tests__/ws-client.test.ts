import type { WsOut } from "@sakti-code/server/ws";
import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";
import { SessionRegistry } from "../session-registry.ts";
import { TerminalRegistry } from "../terminal-registry.ts";
import { createWsClient } from "../ws-client.ts";

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
    terminalRegistry: new TerminalRegistry(),
  };
}

function makeMockWs() {
  const handlers = {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onclose: null as (() => void) | null,
  };
  const sent: string[] = [];
  let readyState = 0;

  const mock = {
    get readyState() {
      return readyState;
    },
    set onopen(fn: (() => void) | null) {
      handlers.onopen = fn;
    },
    set onmessage(fn: ((event: { data: string }) => void) | null) {
      handlers.onmessage = fn;
    },
    set onclose(fn: (() => void) | null) {
      handlers.onclose = fn;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      readyState = 3;
      handlers.onclose?.();
    },
    fireOpen() {
      readyState = 1;
      handlers.onopen?.();
    },
    fireMessage(data: WsOut) {
      handlers.onmessage?.({ data: JSON.stringify(data) });
    },
    fireClose() {
      readyState = 3;
      handlers.onclose?.();
    },
    fireRaw(data: string) {
      handlers.onmessage?.({ data });
    },
    sent,
  };

  function MockWebSocketCtor() {
    return mock;
  }

  return { mock, Ctor: MockWebSocketCtor as never as typeof WebSocket };
}

describe("WS client", () => {
  it("connection starts as connecting", () => {
    const deps = makeDeps();
    const { Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    expect(deps.serverStore.store.connection.status).toBe("connecting");

    ws.disconnect();
  });

  it("welcome frame sets connection to open", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireMessage({ type: "welcome", version: "1.0.0", cwd: "/tmp" });

    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("dispatches event frames to session store", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireMessage({
      type: "event",
      sessionId: "s-test",
      event: { type: "agent_start" },
    });

    const session = deps.sessionRegistry.get("s-test");
    expect(session.store.streaming.phase).toBe("thinking");

    ws.disconnect();
  });

  it("send serializes and sends prompt frame", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

    expect(mock.sent).toHaveLength(1);
    expect(JSON.parse(mock.sent[0]!)).toEqual({
      type: "prompt",
      sessionId: "s1",
      message: "hello",
    });

    ws.disconnect();
  });

  it("send is dropped when socket not open", () => {
    const deps = makeDeps();
    const { Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });
    expect(deps.serverStore.store.connection.status).toBe("connecting");

    ws.disconnect();
  });

  it("error frame sets error on current message", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();

    const session = deps.sessionRegistry.get("s1");
    session.actions.addMessage({
      id: "m1",
      role: "assistant",
      content: "",
      parts: [],
      isStreaming: true,
      timestamp: Date.now(),
    });
    session.actions.setCurrentMessage("m1");

    mock.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

    expect(session.store.messages.m1!.error).toBe("boom");
    expect(session.store.streaming.phase).toBe("error");

    ws.disconnect();
  });

  it("push frame routes terminal data", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireMessage({
      type: "push",
      channel: "terminal.data",
      data: { terminalId: "t1", data: "hello terminal" },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.store.buffer).toBe("hello terminal");

    ws.disconnect();
  });

  it("push frame routes terminal exit", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireMessage({
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t1", exitCode: 0 },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.store.exitCode).toBe(0);

    ws.disconnect();
  });

  it("malformed JSON is silently ignored", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireRaw("not valid json {{{");

    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("disconnect sets connection to closed", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    ws.disconnect();

    expect(deps.serverStore.store.connection.status).toBe("closed");
  });
});
