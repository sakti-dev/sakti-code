import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("LSP Routes", () => {
  describe("GET /api/lsp/status", () => {
    it("should return server status", async () => {
      const app = new Hono();
      const { default: lspRouter } = await import("@/routes/lsp");
      app.route("/", lspRouter);

      const res = await app.request("/api/lsp/status?directory=/test");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("servers");
      expect(json).toHaveProperty("directory");
    });
  });
});
