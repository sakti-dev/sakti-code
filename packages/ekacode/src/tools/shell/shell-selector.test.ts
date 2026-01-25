/**
 * Tests for shell-selector.ts
 */

import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAcceptableShell, getPreferredShell } from "./shell-selector";

// Mock node:child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

describe("getPreferredShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SHELL;
    delete process.env.OPENCODE_GIT_BASH_PATH;
    delete process.env.COMSPEC;
  });

  describe("on Unix systems", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", {
        value: "linux",
      });
    });

    it("should return SHELL env var if it exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      process.env.SHELL = "/bin/bash";

      const result = getPreferredShell();

      expect(result).toBe("/bin/bash");
      expect(existsSync).toHaveBeenCalledWith("/bin/bash");
    });

    it("should fallback to /bin/sh if SHELL doesn't exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      process.env.SHELL = "/nonexistent/shell";

      const result = getPreferredShell();

      expect(result).toBe("/bin/sh");
    });

    it("should fallback to /bin/sh if SHELL not set", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      delete process.env.SHELL;

      const result = getPreferredShell();

      expect(result).toBe("/bin/sh");
    });
  });

  describe("on macOS", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
      });
    });

    it("should fallback to /bin/zsh if SHELL not set", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      delete process.env.SHELL;

      const result = getPreferredShell();

      expect(result).toBe("/bin/zsh");
    });

    it("should return SHELL env var if it exists on macOS", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      process.env.SHELL = "/bin/zsh";

      const result = getPreferredShell();

      expect(result).toBe("/bin/zsh");
    });
  });

  describe("on Windows", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
    });

    it("should use OPENCODE_GIT_BASH_PATH if set and exists", () => {
      const gitBashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
      vi.mocked(existsSync).mockReturnValue(true);
      process.env.OPENCODE_GIT_BASH_PATH = gitBashPath;

      const result = getPreferredShell();

      expect(result).toBe(gitBashPath);
    });

    it("should fallback to COMSPEC if Git Bash not found", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      process.env.COMSPEC = "cmd.exe";

      const result = getPreferredShell();

      expect(result).toBe("cmd.exe");
    });

    it("should fallback to cmd.exe if COMSPEC not set", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      delete process.env.COMSPEC;

      const result = getPreferredShell();

      expect(result).toBe("cmd.exe");
    });
  });
});

describe("getAcceptableShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SHELL;
  });

  it("should return SHELL if not blacklisted", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SHELL = "/bin/bash";

    const result = getAcceptableShell();

    expect(result).toBe("/bin/bash");
  });

  it("should reject fish shell", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SHELL = "/usr/bin/fish";

    const result = getAcceptableShell();

    expect(result).toBe("/bin/sh"); // Fallback
  });

  it("should reject nushell", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SHELL = "/usr/bin/nu";

    const result = getAcceptableShell();

    expect(result).toBe("/bin/sh"); // Fallback
  });

  it("should accept zsh", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.SHELL = "/bin/zsh";

    const result = getAcceptableShell();

    expect(result).toBe("/bin/zsh");
  });
});
