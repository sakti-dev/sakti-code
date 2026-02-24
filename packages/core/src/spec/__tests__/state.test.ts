/**
 * Tests for Spec State Mirror
 *
 * Phase 2 - Spec System Tests
 * Tests verify:
 * - SpecStateMirror: Read/write spec.json with safe semantics
 * - readSpecState: Safe read with defaults for missing files
 * - writeSpecState: Write with error handling
 */

import { promises as fs } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Spec State Mirror", () => {
  let SpecStateMirror: typeof import("@/spec/state").SpecStateMirror;
  let readSpecState: typeof import("@/spec/state").readSpecState;
  let writeSpecState: typeof import("@/spec/state").writeSpecState;
  let tempDir: string;

  beforeAll(async () => {
    const state = await import("@/spec/state");
    SpecStateMirror = state.SpecStateMirror;
    readSpecState = state.readSpecState;
    writeSpecState = state.writeSpecState;

    tempDir = path.join("/tmp", `state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("SpecStateMirror class", () => {
    it("should create mirror with default values for missing spec.json", async () => {
      const mirror = new SpecStateMirror(path.join(tempDir, "missing-spec.json"));
      const state = await mirror.read();

      expect(state).toEqual({
        feature_name: null,
        phase: null,
        approvals: {
          requirements: { generated: false, approved: false },
          design: { generated: false, approved: false },
          tasks: { generated: false, approved: false },
        },
        ready_for_implementation: false,
        language: "en",
      });
    });

    it("should read existing spec.json", async () => {
      const specPath = path.join(tempDir, "existing-spec.json");
      const existingSpec = {
        feature_name: "test-feature",
        phase: "requirements",
        approvals: {
          requirements: { generated: true, approved: true },
          design: { generated: false, approved: false },
          tasks: { generated: false, approved: false },
        },
        ready_for_implementation: false,
        language: "en",
      };
      await fs.writeFile(specPath, JSON.stringify(existingSpec, null, 2));

      const mirror = new SpecStateMirror(specPath);
      const state = await mirror.read();

      expect(state.feature_name).toBe("test-feature");
      expect(state.phase).toBe("requirements");
      expect(state.approvals.requirements.approved).toBe(true);
    });

    it("should write spec.json", async () => {
      const specPath = path.join(tempDir, "write-test.json");
      const mirror = new SpecStateMirror(specPath);

      await mirror.write({
        feature_name: "new-feature",
        phase: "tasks-generated",
        approvals: {
          requirements: { generated: true, approved: true },
          design: { generated: true, approved: true },
          tasks: { generated: true, approved: true },
        },
        ready_for_implementation: true,
        language: "en",
      });

      const content = await fs.readFile(specPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.feature_name).toBe("new-feature");
      expect(parsed.phase).toBe("tasks-generated");
      expect(parsed.ready_for_implementation).toBe(true);
    });

    it.skip("should emit warning on write failure", async () => {
      const mirror = new SpecStateMirror("/proc/0/fd/999/spec.json");
      const result = await mirror.write({
        feature_name: "test",
        phase: "init",
        approvals: {
          requirements: { generated: false, approved: false },
          design: { generated: false, approved: false },
          tasks: { generated: false, approved: false },
        },
        ready_for_implementation: false,
        language: "en",
      });

      expect(result.ok).toBe(false);
      expect(result.warning).toBeDefined();
    });
  });

  describe("readSpecState", () => {
    it("should return default state for missing file", async () => {
      const state = await readSpecState(path.join(tempDir, "missing.json"));
      expect(state.feature_name).toBeNull();
      expect(state.phase).toBeNull();
    });

    it("should read existing file", async () => {
      const specPath = path.join(tempDir, "read-exists.json");
      await fs.writeFile(specPath, JSON.stringify({ feature_name: "test", phase: "design" }));

      const state = await readSpecState(specPath);
      expect(state.feature_name).toBe("test");
      expect(state.phase).toBe("design");
    });
  });

  describe("writeSpecState", () => {
    it("should write state to file", async () => {
      const specPath = path.join(tempDir, "write-state.json");
      const state = {
        feature_name: "write-test",
        phase: "tasks-generated",
        approvals: {
          requirements: { generated: true, approved: false },
          design: { generated: false, approved: false },
          tasks: { generated: false, approved: false },
        },
        ready_for_implementation: false,
        language: "en",
      };

      const result = await writeSpecState(specPath, state);

      expect(result.ok).toBe(true);
      const content = await fs.readFile(specPath, "utf-8");
      expect(JSON.parse(content).feature_name).toBe("write-test");
    });

    it("should return warning on invalid path", async () => {
      const result = await writeSpecState("/invalid/path/spec.json", {
        feature_name: "test",
        phase: "init",
        approvals: {
          requirements: { generated: false, approved: false },
          design: { generated: false, approved: false },
          tasks: { generated: false, approved: false },
        },
        ready_for_implementation: false,
        language: "en",
      });

      expect(result.ok).toBe(false);
      expect(result.warning).toBeDefined();
    });
  });
});
