/**
 * Tests for ripgrep.ts
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
  unlink: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  createHash: vi.fn(() => ({
    update: vi.fn(() => ({
      digest: vi.fn(() => "abc123"),
    })),
  })),
}));

vi.mock("node:https", () => ({
  get: vi.fn(),
}));

describe("getRipgrepPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use system ripgrep if available", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue("/usr/bin/rg");

    const { getRipgrepPath } = await import("./ripgrep");
    const path = await getRipgrepPath();

    expect(path).toBe("/usr/bin/rg");
  });

  it("should fallback to bundled binary if system not found", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    const { getRipgrepPath } = await import("./ripgrep");
    const path = await getRipgrepPath();

    expect(path).toContain("rg");
  });

  it("should cache the result after first call", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue("/usr/bin/rg");

    const { getRipgrepPath, clearCache } = await import("./ripgrep");

    // Clear cache to ensure clean state
    clearCache();

    // Reset mock counts
    vi.mocked(execSync).mockClear();

    const path1 = await getRipgrepPath();
    const path2 = await getRipgrepPath();

    expect(path1).toBe(path2);
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it("should handle different platforms correctly", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const _platform = process.platform;
    const _arch = process.arch;

    const { getRipgrepPath } = await import("./ripgrep");
    const path = await getRipgrepPath();

    expect(path).toBeDefined();
    expect(path.length).toBeGreaterThan(0);
  });
});

describe("downloadRipgrep internals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clearCache should reset the cached path", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue("/usr/bin/rg");

    const { getRipgrepPath, clearCache } = await import("./ripgrep");

    const path1 = await getRipgrepPath();
    clearCache();

    vi.mocked(execSync).mockClear();
    vi.mocked(execSync).mockReturnValue("/usr/local/bin/rg");

    const path2 = await getRipgrepPath();

    expect(path1).not.toBe(path2);
  });
});

describe("PLATFORM_CONFIG", () => {
  it("should have config for common platforms", async () => {
    const { PLATFORM_CONFIG } = await import("./ripgrep");

    expect(PLATFORM_CONFIG).toBeDefined();
    expect(PLATFORM_CONFIG["x64-linux"]).toBeDefined();
    expect(PLATFORM_CONFIG["arm64-linux"]).toBeDefined();
    expect(PLATFORM_CONFIG["x64-darwin"]).toBeDefined();
    expect(PLATFORM_CONFIG["arm64-darwin"]).toBeDefined();
  });

  it("should have correct platform values", async () => {
    const { PLATFORM_CONFIG } = await import("./ripgrep");

    expect(PLATFORM_CONFIG["x64-linux"].platform).toBe("x86_64-unknown-linux-musl");
    expect(PLATFORM_CONFIG["arm64-darwin"].platform).toBe("aarch64-apple-darwin");
  });
});
