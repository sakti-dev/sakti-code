/**
 * Tests for project route
 *
 * Tests the GET /api/project and GET /api/projects endpoints
 */

import { describe, expect, it } from "vitest";

describe("project routes", () => {
  describe("GET /api/project", () => {
    it("returns detected project for explicit directory", async () => {
      const projectRouter = (await import("../../src/routes/project")).default;

      const response = await projectRouter.request(
        "http://localhost/api/project?directory=/home/eekrain/CODE/sakti-code",
        { method: "GET" }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("name");
      expect(body).toHaveProperty("path");
      expect(body).toHaveProperty("detectedBy");
    });

    it("returns 400 for empty directory", async () => {
      const projectRouter = (await import("../../src/routes/project")).default;

      const response = await projectRouter.request("http://localhost/api/project?directory=", {
        method: "GET",
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
    });

    it("returns project info with required keys", async () => {
      const projectRouter = (await import("../../src/routes/project")).default;

      const response = await projectRouter.request(
        "http://localhost/api/project?directory=/home/eekrain/CODE/sakti-code",
        { method: "GET" }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBeDefined();
      expect(body.path).toBeDefined();
      expect(typeof body.name).toBe("string");
    });
  });

  describe("GET /api/projects", () => {
    it("returns list of projects", async () => {
      const projectRouter = (await import("../../src/routes/project")).default;

      const response = await projectRouter.request("http://localhost/api/projects", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("projects");
      expect(Array.isArray(body.projects)).toBe(true);
    });
  });
});
