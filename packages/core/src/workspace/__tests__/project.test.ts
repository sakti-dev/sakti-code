/**
 * Project detection tests
 */

import { detectProject, findProjectRootFromPath } from "@/workspace/project";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("detectProject", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sakti-code-project-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detects project root from .git directory", async () => {
    const projectRoot = path.join(tempDir, "repo");
    const nested = path.join(projectRoot, "src", "nested");

    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
    await fs.mkdir(nested, { recursive: true });

    const result = await detectProject(nested);

    expect(result.root).toBe(projectRoot);
  });

  it("detects Node.js project from package.json", async () => {
    const projectRoot = path.join(tempDir, "node");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "my-app" }),
      "utf-8"
    );

    const result = await detectProject(projectRoot);

    expect(result.packageJson?.name).toBe("my-app");
    expect(result.name).toBe("my-app");
  });

  it("falls back to directory name when no markers exist", async () => {
    const projectRoot = path.join(tempDir, "plain");
    await fs.mkdir(projectRoot, { recursive: true });

    const result = await detectProject(projectRoot);

    expect(result.root).toBe(projectRoot);
    expect(result.name).toBe("plain");
  });

  it("returns absolute root path", async () => {
    const projectRoot = path.join(tempDir, "abs");
    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });

    const result = await detectProject(projectRoot);

    expect(path.isAbsolute(result.root)).toBe(true);
  });
});

describe("findProjectRootFromPath", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sakti-code-project-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("finds project root from nested file path", async () => {
    const projectRoot = path.join(tempDir, "repo");
    const nestedFile = path.join(projectRoot, "src", "nested", "file.ts");

    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await fs.writeFile(nestedFile, "export const x = 1;", "utf-8");

    const result = await findProjectRootFromPath(nestedFile);

    expect(result).toBe(projectRoot);
  });

  it("falls back to directory when no markers are present", async () => {
    const projectRoot = path.join(tempDir, "no-markers");
    const nestedFile = path.join(projectRoot, "src", "file.ts");

    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await fs.writeFile(nestedFile, "export const x = 1;", "utf-8");

    const result = await findProjectRootFromPath(nestedFile);

    expect(result).toBe(path.dirname(nestedFile));
  });
});
