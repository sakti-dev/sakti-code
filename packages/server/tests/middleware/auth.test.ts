/**
 * Tests for auth middleware
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";

describe("auth middleware", () => {
  let mockApp: Hono<any>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set test environment variables
    process.env.SAKTI_CODE_USERNAME = "testuser";
    process.env.SAKTI_CODE_PASSWORD = "testpass";

    // Clear module cache to reload with new env vars
    vi.resetModules();

    // Create a test app with request logging (sets requestId)
    mockApp = new Hono<Env>();

    // Add request logging middleware first (sets requestId)
    mockApp.use("*", async (c, next) => {
      const { v7: uuidv7 } = await import("uuid");
      const requestId = uuidv7();
      c.set("requestId", requestId);
      await next();
    });

    // Import and use the auth middleware
    const { authMiddleware } = await import("../../src/middleware/auth");
    mockApp.use("*", authMiddleware);

    // Add test endpoints
    mockApp.get("/api/health", c => {
      return c.json({ status: "ok" });
    });

    mockApp.get("/protected", c => {
      return c.json({ message: "success" });
    });
  });

  describe("health endpoint", () => {
    it("should allow access without credentials", async () => {
      const response = await mockApp.request("/api/health");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
    });

    it("should allow access with credentials", async () => {
      const credentials = btoa("testuser:testpass");
      const response = await mockApp.request("/api/health", {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe("protected endpoints", () => {
    it("should reject request without Authorization header", async () => {
      const response = await mockApp.request("/protected");
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe("UNAUTHORIZED");
      expect(data.error.message).toBe("Missing credentials");
      expect(data.error.requestId).toBeDefined();
    });

    it("should reject request with invalid Authorization format", async () => {
      const response = await mockApp.request("/protected", {
        headers: {
          Authorization: "Bearer invalid",
        },
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.code).toBe("UNAUTHORIZED");
      expect(data.error.message).toBe("Missing credentials");
    });

    it("should reject request with invalid credentials", async () => {
      const credentials = btoa("wronguser:wrongpass");
      const response = await mockApp.request("/protected", {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.code).toBe("UNAUTHORIZED");
      expect(data.error.message).toBe("Invalid credentials");
    });

    it("should accept request with valid credentials", async () => {
      const credentials = btoa("testuser:testpass");
      const response = await mockApp.request("/protected", {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe("success");
    });

    it("should accept request with password containing special characters", async () => {
      // Edge case: password contains special characters
      process.env.SAKTI_CODE_USERNAME = "testuser";
      process.env.SAKTI_CODE_PASSWORD = "p@ss!w0rd#123";

      const credentials = btoa("testuser:p@ss!w0rd#123");
      const response = await mockApp.request("/protected", {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe("success");
    });
  });

  describe("malformed credentials", () => {
    it("should handle invalid base64", async () => {
      const response = await mockApp.request("/protected", {
        headers: {
          Authorization: "Basic !@#$%^&*()",
        },
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.code).toBe("UNAUTHORIZED");
    });

    it("should handle credentials without colon", async () => {
      const credentials = btoa("no-colon-here");
      const response = await mockApp.request("/protected", {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.code).toBe("UNAUTHORIZED");
    });
  });
});
