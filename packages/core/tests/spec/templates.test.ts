/**
 * Tests for Spec Templates
 *
 * Phase 1 - Spec System Tests
 * Tests verify:
 * - writeSpecTemplate: Creates spec files with templates
 */

import { promises as fs } from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("Spec Templates", () => {
  let writeSpecTemplate: typeof import("../../src/spec/templates").writeSpecTemplate;
  let tempDir: string;

  beforeEach(async () => {
    const templates = await import("../../src/spec/templates");
    writeSpecTemplate = templates.writeSpecTemplate;

    // Create temp directory for each test
    tempDir = path.join("/tmp", `spec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("writeSpecTemplate", () => {
    it("should create all required spec files", async () => {
      await writeSpecTemplate(tempDir, "user-auth", "Implement user authentication");

      const files = await fs.readdir(tempDir);
      expect(files).toContain("requirements.md");
      expect(files).toContain("design.md");
      expect(files).toContain("tasks.md");
      expect(files).toContain("correctness.md");
    });

    it("should create requirements.md with placeholder content", async () => {
      await writeSpecTemplate(tempDir, "user-auth", "Implement user authentication");

      const content = await fs.readFile(path.join(tempDir, "requirements.md"), "utf-8");
      expect(content).toContain("# Requirements: user-auth");
      expect(content).toContain("Implement user authentication");
      expect(content).toContain("R-001");
    });

    it("should create design.md with placeholder content", async () => {
      await writeSpecTemplate(tempDir, "user-auth", "Implement user authentication");

      const content = await fs.readFile(path.join(tempDir, "design.md"), "utf-8");
      expect(content).toContain("# Design: user-auth");
      expect(content).toContain("Implement user authentication");
    });

    it("should create tasks.md with placeholder content", async () => {
      await writeSpecTemplate(tempDir, "user-auth", "Implement user authentication");

      const content = await fs.readFile(path.join(tempDir, "tasks.md"), "utf-8");
      expect(content).toContain("# Tasks: user-auth");
      expect(content).toContain("T-001");
      expect(content).toContain("Maps to requirements");
    });

    it("should create correctness.md with placeholder content", async () => {
      await writeSpecTemplate(tempDir, "user-auth", "Implement user authentication");

      const content = await fs.readFile(path.join(tempDir, "correctness.md"), "utf-8");
      expect(content).toContain("# Correctness: user-auth");
      expect(content).toContain("P-001");
    });

    it("should use the spec slug in the content", async () => {
      await writeSpecTemplate(tempDir, "api-v2", "Design API v2");

      const tasksContent = await fs.readFile(path.join(tempDir, "tasks.md"), "utf-8");
      expect(tasksContent).toContain("api-v2");
    });

    it("should use the description in the content", async () => {
      await writeSpecTemplate(tempDir, "my-feature", "My custom description");

      const designContent = await fs.readFile(path.join(tempDir, "design.md"), "utf-8");
      expect(designContent).toContain("My custom description");
    });

    it("should overwrite existing files", async () => {
      // Create initial file
      await fs.writeFile(path.join(tempDir, "tasks.md"), "Old content");

      // Call template again
      await writeSpecTemplate(tempDir, "user-auth", "New description");

      const content = await fs.readFile(path.join(tempDir, "tasks.md"), "utf-8");
      expect(content).toContain("# Tasks: user-auth");
      expect(content).not.toContain("Old content");
    });
  });
});
