import { describe, expect, it } from "vite-plus/test";
import { SessionRegistry } from "../../session/session-registry.ts";
import { TerminalRegistry } from "../../terminal/terminal-registry.ts";
import { isStreaming } from "../../workspace/ui-signals.ts";
import { createServerStore } from "../server-store.ts";
import { createWsClient, type WsConnectable } from "../ws-client.ts";

type EventListener = (event: { data?: unknown }) => void;

function makeFakeWebSocket() {
  const listeners = new Map<string, Set<EventListener>>();
  const sent: string[] = [];
  let readyState = 0;

  const ws = {
    readyState,
    addEventListener(type: string, listener: EventListener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      readyState = 3;
      for (const h of listeners.get("close") ?? []) {
        h({});
      }
    },
  };

  Object.defineProperty(ws, "readyState", {
    get: () => readyState,
  });

  return {
    ws,
    sent,
    fireOpen() {
      readyState = 1;
      for (const h of listeners.get("open") ?? []) {
        h({});
      }
    },
    fireMessage(data: unknown) {
      for (const h of listeners.get("message") ?? []) {
        h({ data: JSON.stringify(data) });
      }
    },
    fireClose() {
      readyState = 3;
      for (const h of listeners.get("close") ?? []) {
        h({});
      }
    },
  };
}

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
    terminalRegistry: new TerminalRegistry(),
  };
}

function makeMockApi() {
  const fake = makeFakeWebSocket();
  const api: WsConnectable = {
    ws: {
      $ws: () => fake.ws as unknown as WebSocket,
    },
  };
  return { api, fake };
}

describe("WS client", () => {
  it("connection starts as connecting", () => {
    const deps = makeDeps();
    const { api } = makeMockApi();
    const ws = createWsClient(api, deps);

    expect(deps.serverStore.store.connection.status).toBe("connecting");

    ws.disconnect();
  });

  it("welcome frame sets connection to open", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({ type: "welcome", version: "1.0.0", cwd: "/tmp" });

    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("dispatches event frames to session store", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({
      type: "event",
      sessionId: "s-test",
      event: { type: "agent_start" },
    });

    const session = deps.sessionRegistry.get("s-test");
    expect(session.store.streaming.phase).toBe("thinking");

    ws.disconnect();
  });

  it("send serializes typed message via WebSocket", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

    expect(fake.sent).toHaveLength(1);
    expect(JSON.parse(fake.sent[0]!)).toEqual({
      type: "prompt",
      sessionId: "s1",
      message: "hello",
    });

    ws.disconnect();
  });

  it("send is dropped when socket not open", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });
    expect(fake.sent).toHaveLength(0);

    ws.disconnect();
  });

  it("error frame sets error on current message", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();

    const session = deps.sessionRegistry.get("s1");
    session.actions.startTurn(null);
    session.actions.addAssistantMessage({
      content: "",
      id: "m1",
      isStreaming: true,
      parts: [],
      role: "assistant",
      timestamp: Date.now(),
    });

    fake.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

    expect(session.store.turns[0]!.messages[0]!.error).toBe("boom");
    expect(session.store.streaming.phase).toBe("error");

    ws.disconnect();
  });

  it("push frame routes terminal data", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({
      type: "push",
      channel: "terminal.data",
      data: { terminalId: "t1", data: "hello terminal" },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.buffer).toBe("hello terminal");

    ws.disconnect();
  });

  it("push frame routes terminal exit", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t1", exitCode: 0 },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.store.exitCode).toBe(0);

    ws.disconnect();
  });

  it("disconnect sets connection to closed", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    ws.disconnect();

    expect(deps.serverStore.store.connection.status).toBe("closed");
  });

  it("isStreaming is set true on agent_start", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });

    expect(isStreaming()).toBe(true);
    ws.disconnect();
  });

  it("isStreaming is set false on agent_end", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });
    expect(isStreaming()).toBe(true);

    fake.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_end", messages: [] },
    });
    expect(isStreaming()).toBe(false);
    ws.disconnect();
  });

  it("isStreaming is set false on abort", () => {
    const deps = makeDeps();
    const { api, fake } = makeMockApi();
    const ws = createWsClient(api, deps);

    fake.fireOpen();
    fake.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });
    expect(isStreaming()).toBe(true);

    fake.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "abort" },
    });
    expect(isStreaming()).toBe(false);
    ws.disconnect();
  });
});
