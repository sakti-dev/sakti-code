/**
 * Hono Client Contract Test
 *
 * Validates that the server exports a proper AppType that can be used
 * with hono/client for type-safe RPC calls from the desktop app.
 */

import { describe, expect, it } from "vitest";

describe("Hono Client Contract", () => {
  it("should export app from server package", async () => {
    const { app } = await import("@sakti-code/server");
    expect(app).toBeDefined();
  });

  it("should export app with request method for RPC", async () => {
    const { app } = await import("@sakti-code/server");
    expect(app).toBeDefined();
    expect(typeof app).toBe("object");
    expect(typeof app.request).toBe("function");
    expect(typeof app.fetch).toBe("function");
  });

  it("should have app type compatible with hono/client", async () => {
    const { app } = await import("@sakti-code/server");
    expect(app).toBeDefined();
    expect(typeof app.routes).toBe("object");
  });
});
