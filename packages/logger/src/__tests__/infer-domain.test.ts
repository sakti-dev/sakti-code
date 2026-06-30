import { describe, expect, it } from "vite-plus/test";
import { inferDomain } from "../infer-domain.ts";

describe("inferDomain", () => {
  it("explicit domain wins over module/scope hints", () => {
    expect(inferDomain({ domain: "LLM", module: "auth" })).toBe("LLM");
  });

  it("derives AUTH from module", () => {
    expect(inferDomain({ module: "auth" })).toBe("AUTH");
  });

  it("derives WS from a hyphenated module like ws-client", () => {
    expect(inferDomain({ module: "ws-client" })).toBe("WS");
  });

  it("matches 'websocket' as WS", () => {
    expect(inferDomain({ scope: "websocket-handler" })).toBe("WS");
  });

  it("derives DB / SESSION / TOOL / CHAT / SERVER", () => {
    expect(inferDomain({ module: "db-repo" })).toBe("DB");
    expect(inferDomain({ module: "session-store" })).toBe("SESSION");
    expect(inferDomain({ module: "tool-exec" })).toBe("TOOL");
    expect(inferDomain({ module: "chat-input" })).toBe("CHAT");
    expect(inferDomain({ module: "server-runner" })).toBe("SERVER");
  });

  it("defaults to UI when nothing matches", () => {
    expect(inferDomain({})).toBe("UI");
  });
});
