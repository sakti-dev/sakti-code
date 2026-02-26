/**
 * Tests for health endpoint
 *
 * TDD approach: Tests written first to define expected behavior
 * Now tests against the composed app with health module mounted
 */

import { app } from "@/app/app";
import { describe, expect, it } from "vitest";

describe("health endpoint", () => {
  describe("GET /api/health", () => {
    it("should return 200 with status ok", async () => {
      const response = await app.request("/api/health");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
    });

    it("should return uptime in seconds", async () => {
      const response = await app.request("/api/health");
      const data = await response.json();

      expect(data.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof data.uptime).toBe("number");
    });

    it("should return ISO timestamp", async () => {
      const response = await app.request("/api/health");
      const data = await response.json();

      expect(data.timestamp).toBeDefined();
      expect(() => new Date(data.timestamp)).not.toThrow();
      const timestamp = new Date(data.timestamp);
      const now = new Date();
      const diffMs = now.getTime() - timestamp.getTime();
      expect(diffMs).toBeLessThan(60000);
    });

    it("should return version", async () => {
      const response = await app.request("/api/health");
      const data = await response.json();

      expect(data.version).toBeDefined();
      expect(typeof data.version).toBe("string");
    });

    it("should not require authentication", async () => {
      const response = await app.request("/api/health");

      expect(response.status).toBe(200);
    });

    it("should have content-type application/json", async () => {
      const response = await app.request("/api/health");

      expect(response.headers.get("content-type")).toMatch(/application\/json/);
    });
  });
});
