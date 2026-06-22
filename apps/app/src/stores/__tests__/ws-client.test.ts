import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";
import { SessionRegistry } from "../session-registry.ts";
import { TerminalRegistry } from "../terminal-registry.ts";
import { isStreaming } from "../ui-signals.ts";
import {
  createWsClient,
  type EdenWSLike,
  type WsSubscribeApi,
} from "../ws-client.ts";

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
    terminalRegistry: new TerminalRegistry(),
  };
}

function makeMockEdenWs() {
  const openHandlers: Array<() => void> = [];
  const messageHandlers: Array<(event: { data?: unknown }) => void> = [];
  const closeHandlers: Array<() => void> = [];
  const sent: unknown[] = [];
  let readyState = 0;

  const mock: EdenWSLike = {
    ws: {
      get readyState() {
        return readyState;
      },
    },
    send(data: unknown) {
      sent.push(data);
    },
    on(type, listener) {
      if (type === "open") openHandlers.push(listener as () => void);
      else if (type === "message")
        messageHandlers.push(listener as (e: { data?: unknown }) => void);
      else if (type === "close") closeHandlers.push(listener as () => void);
    },
    close() {
      readyState = 3;
      for (const h of closeHandlers) h();
    },
  };

  return {
    mock,
    sent,
    fireOpen() {
      readyState = 1;
      for (const h of openHandlers) h();
    },
    fireMessage(data: unknown) {
      for (const h of messageHandlers) h({ data });
    },
    fireClose() {
      readyState = 3;
      for (const h of closeHandlers) h();
    },
  };
}

function makeMockApi() {
  const edenWs = makeMockEdenWs();
  const api: WsSubscribeApi = {
    ws: {
      subscribe: () => edenWs.mock,
    },
  };
  return { api, edenWs };
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
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({ type: "welcome", version: "1.0.0", cwd: "/tmp" });

    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("dispatches event frames to session store", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
      type: "event",
      sessionId: "s-test",
      event: { type: "agent_start" },
    });

    const session = deps.sessionRegistry.get("s-test");
    expect(session.store.streaming.phase).toBe("thinking");

    ws.disconnect();
  });

  it("send sends typed message via Eden WS", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

    expect(edenWs.sent).toHaveLength(1);
    expect(edenWs.sent[0]).toEqual({
      type: "prompt",
      sessionId: "s1",
      message: "hello",
    });

    ws.disconnect();
  });

  it("send is dropped when socket not open", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });
    expect(edenWs.sent).toHaveLength(0);

    ws.disconnect();
  });

  it("error frame sets error on current message", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();

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

    edenWs.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

    expect(session.store.messages.m1!.error).toBe("boom");
    expect(session.store.streaming.phase).toBe("error");

    ws.disconnect();
  });

  it("push frame routes terminal data", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
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
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
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
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    ws.disconnect();

    expect(deps.serverStore.store.connection.status).toBe("closed");
  });

  it("isStreaming is set true on agent_start", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });

    expect(isStreaming()).toBe(true);
    ws.disconnect();
  });

  it("isStreaming is set false on agent_end", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });
    expect(isStreaming()).toBe(true);

    edenWs.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_end", messages: [] },
    });
    expect(isStreaming()).toBe(false);
    ws.disconnect();
  });

  it("isStreaming is set false on abort", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });
    expect(isStreaming()).toBe(true);

    edenWs.fireMessage({
      type: "event",
      sessionId: "s1",
      event: { type: "abort" },
    });
    expect(isStreaming()).toBe(false);
    ws.disconnect();
  });
});
