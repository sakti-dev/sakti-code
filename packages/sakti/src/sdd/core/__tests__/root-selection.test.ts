import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveSaktiRoot, RootSelectionError } from "../root-selection.js";

describe("resolveSaktiRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "sakti-root-selection-")),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function mkdir(relativePath: string): string {
    const dir = path.join(tempDir, relativePath);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function createSaktiRoot(rootDir: string): void {
    fs.mkdirSync(path.join(rootDir, ".sakti", "specs"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, ".sakti", "changes", "archive"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, ".sakti", "config.yaml"), "schema: spec-driven\n");
  }

  async function expectRootSelectionError(
    promise: Promise<unknown>,
    code: string,
  ): Promise<RootSelectionError> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RootSelectionError);
    const error = caught as RootSelectionError;
    expect(error.diagnostic.code).toBe(code);
    return error;
  }

  it("resolves the nearest sakti root", async () => {
    const repoRoot = mkdir("app-repo");
    createSaktiRoot(repoRoot);
    const nested = mkdir("app-repo/src/deep");

    const root = await resolveSaktiRoot({ startPath: nested });

    expect(root.source).toBe("nearest");
    expect(root.path).toBe(repoRoot);
  });

  it("ignores leftover workspace view state when a nearest root exists", async () => {
    const workspaceDir = mkdir("workspace");
    fs.mkdirSync(path.join(workspaceDir, ".sakti-workspace"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, ".sakti-workspace", "view.yaml"),
      "version: 1\nname: platform\ncontext: null\nlinks: {}\n",
    );
    const repoRoot = mkdir("workspace/app-repo");
    createSaktiRoot(repoRoot);
    const nested = mkdir("workspace/app-repo/src");

    const root = await resolveSaktiRoot({ startPath: nested });

    expect(root.source).toBe("nearest");
    expect(root.path).toBe(repoRoot);
    expect(root.changesDir).toBe(path.join(repoRoot, ".sakti", "changes"));
    expect(root.defaultSchema).toBe("spec-driven");
  });

  it("treats workspace state alone as no root at all", async () => {
    const workspaceDir = mkdir("workspace-only");
    fs.mkdirSync(path.join(workspaceDir, ".sakti-workspace"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, ".sakti-workspace", "view.yaml"),
      "version: 1\nname: platform\ncontext: null\nlinks: {}\n",
    );

    const root = await resolveSaktiRoot({ startPath: workspaceDir });

    expect(root.source).toBe("implicit");
    expect(root.path).toBe(workspaceDir);
  });

  it("allows an implicit root only when requested", async () => {
    const appRepo = mkdir("implicit-app");

    const implicitRoot = await resolveSaktiRoot({ startPath: appRepo });
    expect(implicitRoot.source).toBe("implicit");
    expect(implicitRoot.path).toBe(appRepo);

    await expectRootSelectionError(
      resolveSaktiRoot({ startPath: appRepo, allowImplicitRoot: false }),
      "no_sakti_root",
    );
  });

  it("keeps config-only directories as plain roots", async () => {
    const dir = mkdir("plain-config-only");
    fs.mkdirSync(path.join(dir, ".sakti"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sakti", "config.yaml"), "schema: spec-driven\n");

    const root = await resolveSaktiRoot({ startPath: dir });
    expect(root.source).toBe("nearest");
    expect(root.path).toBe(dir);
  });

  it("treats empty and comments-only configs as plain roots", async () => {
    const empty = mkdir("empty-config");
    fs.mkdirSync(path.join(empty, ".sakti"), { recursive: true });
    fs.writeFileSync(path.join(empty, ".sakti", "config.yaml"), "");

    const emptyRoot = await resolveSaktiRoot({ startPath: empty });
    expect(emptyRoot.source).toBe("nearest");
    expect(emptyRoot.path).toBe(empty);

    const commented = mkdir("commented-config");
    fs.mkdirSync(path.join(commented, ".sakti"), { recursive: true });
    fs.writeFileSync(path.join(commented, ".sakti", "config.yaml"), "# store: team-context\n");

    const commentedRoot = await resolveSaktiRoot({ startPath: commented });
    expect(commentedRoot.source).toBe("nearest");
    expect(commentedRoot.path).toBe(commented);
  });

  it("skips sakti/ directories that are neither planning-shaped nor configured", async () => {
    // A .sakti/ DIRECTORY alone is not a root — it must carry a planning
    // shape or a config file. Without this, $HOME would become a phantom
    // root that captures every command under the home tree.
    const fakeHome = mkdir("fake-home");
    fs.mkdirSync(path.join(fakeHome, ".sakti", "team-context"), { recursive: true });
    const scratch = mkdir("fake-home/projects/scratch");

    const root = await resolveSaktiRoot({ startPath: scratch });
    expect(root.source).toBe("implicit");
  });
});
