import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { gatherEnvironmentInfo } from "../environment.ts";

describe("gatherEnvironmentInfo", () => {
  it("includes working directory from cwd argument", () => {
    const info = gatherEnvironmentInfo("/some/path", "claude-sonnet-4-5");
    expect(info.workingDirectory).toBe("/some/path");
  });

  it("detects git repo when .git exists in cwd", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakti-test-"));
    fs.mkdirSync(path.join(tmpDir, ".git"));
    try {
      const info = gatherEnvironmentInfo(tmpDir, "test-model");
      expect(info.isGitRepo).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects non-git repo when .git is absent", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakti-test-"));
    try {
      const info = gatherEnvironmentInfo(tmpDir, "test-model");
      expect(info.isGitRepo).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes platform string", () => {
    const info = gatherEnvironmentInfo("/tmp", "test-model");
    expect(typeof info.platform).toBe("string");
    expect(info.platform.length).toBeGreaterThan(0);
  });

  it("includes human-readable date string", () => {
    const info = gatherEnvironmentInfo("/tmp", "test-model");
    expect(typeof info.date).toBe("string");
    expect(info.date.length).toBeGreaterThan(0);
  });

  it("includes modelId from argument", () => {
    const info = gatherEnvironmentInfo("/tmp", "anthropic/claude-sonnet-4-5");
    expect(info.modelId).toBe("anthropic/claude-sonnet-4-5");
  });
});
