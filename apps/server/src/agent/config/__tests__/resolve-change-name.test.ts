import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveActiveChangeName } from "../resolve-change-name.ts";

describe("resolveActiveChangeName", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "sakti-test-"));
  });

  afterEach(() => {
    // tmpdir auto-cleans; nothing needed
  });

  it("returns the most recently created change dir", () => {
    const changesDir = join(cwd, ".sakti/changes");
    mkdirSync(join(changesDir, "older-change"), { recursive: true });
    writeFileSync(join(changesDir, "older-change", ".sakti.yaml"), "name: older-change\n");
    mkdirSync(join(changesDir, "newer-change"), { recursive: true });
    writeFileSync(join(changesDir, "newer-change", ".sakti.yaml"), "name: newer-change\n");
    // Bump mtime to ensure ordering.
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(changesDir, "newer-change", ".sakti.yaml"), future, future);

    expect(resolveActiveChangeName(cwd)).toBe("newer-change");
  });

  it("returns null when no changes dir exists", () => {
    expect(resolveActiveChangeName(cwd)).toBeNull();
  });

  it("returns null when changes dir is empty", () => {
    mkdirSync(join(cwd, ".sakti/changes"), { recursive: true });
    expect(resolveActiveChangeName(cwd)).toBeNull();
  });

  it("ignores non-directory entries", () => {
    const changesDir = join(cwd, ".sakti/changes");
    mkdirSync(changesDir, { recursive: true });
    writeFileSync(join(changesDir, "README.md"), "not a change");
    expect(resolveActiveChangeName(cwd)).toBeNull();
  });
});
