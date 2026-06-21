import { describe, expect, it } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { buildWsApp, createWelcomeFrame, SERVER_VERSION } from "../agent/ws.ts";

describe("WS welcome push", () => {
  it("createWelcomeFrame emits a welcome frame with type/version/cwd", () => {
    const frame = JSON.parse(createWelcomeFrame());
    expect(frame.type).toBe("welcome");
    expect(frame.version).toBe(SERVER_VERSION);
    expect(frame.cwd).toBe(process.cwd());
  });

  it("SERVER_VERSION is a non-empty string read from package.json", () => {
    expect(typeof SERVER_VERSION).toBe("string");
    expect(SERVER_VERSION.length).toBeGreaterThan(0);
    expect(SERVER_VERSION).toBe(pkg.version ?? "0.0.0");
  });

  it("buildWsApp compiles to a valid handler with ws configured", () => {
    const app = buildWsApp();
    expect(app).toBeDefined();
    expect(typeof (app as any)?.fetch).toBe("function");
  });
});
