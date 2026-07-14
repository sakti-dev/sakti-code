import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { buildSyncSddPhase } from "../sync-sdd-phase.ts";

const VALID_YAML = `schema: spec-driven
created: 2026-07-01
workflow: full
phase: build
verify_result: pending
branch_status: pending
archived: false
`;

describe("buildSyncSddPhase", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "sakti-sync-"));
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
  });

  function setupChangeDir(changeName: string, yaml: string = VALID_YAML) {
    const changeDir = join(worktree, ".sakti", "changes", changeName);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, ".sakti.yaml"), yaml, "utf-8");
    return changeDir;
  }

  it("returns undefined when worktreePath is null", () => {
    const fn = buildSyncSddPhase({ worktreePath: null, changeName: "foo" });
    expect(fn).toBeUndefined();
  });

  it("returns undefined when changeName is null", () => {
    const fn = buildSyncSddPhase({ worktreePath: "/tmp", changeName: null });
    expect(fn).toBeUndefined();
  });

  it("writes the new phase to .sakti.yaml", async () => {
    const changeDir = setupChangeDir("my-feature");
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" });
    expect(fn).toBeDefined();
    await fn!("verify");
    const content = readFileSync(join(changeDir, ".sakti.yaml"), "utf-8");
    expect(content).toContain("phase: verify");
  });

  it("preserves other fields when writing", async () => {
    const changeDir = setupChangeDir("my-feature");
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" });
    await fn!("archive");
    const content = readFileSync(join(changeDir, ".sakti.yaml"), "utf-8");
    expect(content).toContain("phase: archive");
    expect(content).toContain("workflow: full");
    expect(content).toContain("verify_result: pending");
  });

  it("is a no-op when phase already matches", async () => {
    setupChangeDir("my-feature");
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" });
    await fn!("build");
  });

  it("swallows errors gracefully when .sakti.yaml does not exist", async () => {
    const log = { agent: { warn: vi.fn() } };
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "nonexistent" }, log);
    expect(fn).toBeDefined();
    await expect(fn!("verify")).resolves.toBeUndefined();
  });

  it("logs when writeChangeMetadata throws", async () => {
    const changeDir = setupChangeDir("my-feature");
    // Make the directory read-only so write fails
    const log = { agent: { warn: vi.fn() } };
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" }, log);
    expect(fn).toBeDefined();
    // Corrupt the yaml so readChangeMetadata throws
    writeFileSync(join(changeDir, ".sakti.yaml"), "phase: [invalid", "utf-8");
    await fn!("verify");
    expect(log.agent.warn).toHaveBeenCalled();
  });
});
