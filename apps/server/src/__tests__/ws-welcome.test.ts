import { describe, expect, it } from "bun:test";

describe("WS welcome push", () => {
  it("createWelcomeFrame returns valid welcome frame", async () => {
    const { createWelcomeFrame, SERVER_VERSION } = await import(
      "../agent/ws.ts"
    );

    const frame = JSON.parse(createWelcomeFrame());
    expect(frame).toHaveProperty("type", "welcome");
    expect(frame).toHaveProperty("version", SERVER_VERSION);
    expect(frame).toHaveProperty("cwd", process.cwd());
  });

  it("SERVER_VERSION is a non-empty string", async () => {
    const { SERVER_VERSION } = await import("../agent/ws.ts");
    expect(typeof SERVER_VERSION).toBe("string");
    expect(SERVER_VERSION.length).toBeGreaterThan(0);
  });
});
