import { Database } from "bun:sqlite";
import { initDatabase } from "@sakti-code/db";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { buildWsApp, createWelcomeFrame, SERVER_VERSION } from "../agent/ws.ts";
import { createContext } from "../context.ts";
import { createApiKeyStore } from "../lib/api-key-store.ts";

describe("WS welcome push", () => {
  it("createWelcomeFrame emits a welcome frame with type/version/cwd", () => {
    const frame = createWelcomeFrame();
    expect(frame.type).toBe("welcome");
    expect(frame.version).toBe(SERVER_VERSION);
    expect(frame.cwd).toBe(process.cwd());
  });

  it("SERVER_VERSION is a non-empty string read from package.json", () => {
    expect(typeof SERVER_VERSION).toBe("string");
    expect(SERVER_VERSION.length).toBeGreaterThan(0);
    expect(SERVER_VERSION).toBe(pkg.version ?? "0.0.0");
  });

  it("buildWsApp compiles to a valid handler with ws configured", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(
      db,
      {},
      createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`)
    );
    const app = buildWsApp(ctx);
    expect(app).toBeDefined();
    expect(typeof (app as { fetch?: unknown }).fetch).toBe("function");
  });
});
