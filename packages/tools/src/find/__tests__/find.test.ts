import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@sakti-code/agent";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { classifyRgExitCode, createFindTool, resolveGlobPattern } from "../index.ts";

function getTextContent(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  if (first && "text" in first) {
    return first.text;
  }
  return "";
}

describe("find: classifyRgExitCode (pure)", () => {
  it("returns 'results' for exit code 0", () => {
    expect(classifyRgExitCode(0, "src/a.ts\n", "")).toEqual({ kind: "results" });
  });

  it("returns 'empty' for exit code 1 (no matches is NOT an error)", () => {
    expect(classifyRgExitCode(1, "", "")).toEqual({ kind: "empty" });
  });

  it("returns 'empty' for exit code 1 even if stderr is non-empty (pins rg contract)", () => {
    expect(classifyRgExitCode(1, "", "warning: something")).toEqual({ kind: "empty" });
  });

  it("returns 'error' with stderr message for exit code 2", () => {
    const out = classifyRgExitCode(2, "", "rg: IO error: No such file (os error 2)");
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.message).toContain("os error 2");
    }
  });

  it("returns 'error' with fallback message when exit >=2 and stderr empty", () => {
    const out = classifyRgExitCode(2, "", "");
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.message).toMatch(/rg failed/i);
      expect(out.message).toContain("exit 2");
    }
  });

  it("returns 'error' for unusual exit codes (e.g. 130 SIGINT)", () => {
    expect(classifyRgExitCode(130, "", "").kind).toBe("error");
  });

  it("never throws — pure function", () => {
    expect(() => classifyRgExitCode(-1, "", "")).not.toThrow();
  });
});

describe("find: fragment dispatch (resolveGlobPattern)", () => {
  it("leaves a real glob pattern unchanged", () => {
    expect(resolveGlobPattern("**/*.ts")).toBe("**/*.ts");
    expect(resolveGlobPattern("src/**/*.spec.ts")).toBe("src/**/*.spec.ts");
    expect(resolveGlobPattern("*.{ts,tsx}")).toBe("*.{ts,tsx}");
  });

  it("upgrades a bare name fragment into a substring glob", () => {
    expect(resolveGlobPattern("Button")).toBe("**/*Button*");
    expect(resolveGlobPattern("AuthService")).toBe("**/*AuthService*");
  });
});

describe("find: rg argv validity", () => {
  // Guards against hallucinated rg flags (e.g. the earlier --binary-rules mistake).
  it("uses only flags the real rg binary accepts for the --files invocation", () => {
    const flags = [
      "--no-config",
      "--files",
      "--hidden",
      "--no-ignore",
      "--glob=!**/.git/**",
      "--glob=!**/node_modules/**",
      "--glob=*.ts",
    ];
    expect(() => {
      execFileSync("rg", [...flags, "."], { stdio: "ignore" });
    }).not.toThrow();
  });

  // End-to-end: proves the fd -> rg migration actually finds files via the
  // production branch (no custom ops injected). This is the core fix.
  describe("createFindTool production branch (rg --files)", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "sakti-find-"));
      writeFileSync(join(dir, "alpha.ts"), "x");
      writeFileSync(join(dir, "beta.md"), "y");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("returns files matching a glob via rg", async () => {
      const tool = createFindTool(dir);
      const result = await tool.execute("tc", { pattern: "*.ts" });
      const text = getTextContent(result);
      expect(text).toContain("alpha.ts");
      expect(text).not.toContain("beta.md");
    });

    it("upgrades a bare fragment into a substring match via rg", async () => {
      const tool = createFindTool(dir);
      const result = await tool.execute("tc", { pattern: "alph" });
      const text = getTextContent(result);
      expect(text).toContain("alpha.ts");
    });
  });
});

describe("find: gitignore regression (--no-ignore reaches gitignored content)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-gitignore-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a gitignored .ts file instead of a false 'no files found'", async () => {
    writeFileSync(join(dir, ".gitignore"), "secret.ts\n");
    writeFileSync(join(dir, "secret.ts"), "export const SECRET = 1;\n");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "*.ts" });
    const text = getTextContent(result);
    expect(text).toContain("secret.ts");
  });
});

describe("find: no matches returns a friendly message, never 'rg exited with code'", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-empty-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns a friendly message for a pattern that matches nothing (report 1.6)", async () => {
    writeFileSync(join(dir, "real.ts"), "x");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "zzz_nonexistent_xyz" });
    const text = getTextContent(result);
    expect(text).not.toContain("rg exited with code");
    expect(text).not.toContain("os error");
    expect(text.toLowerCase()).toContain("no files found");
    expect(text).toContain("zzz_nonexistent_xyz");
  });

  it("returns the same friendly message when a path is given (report 1.7)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "*.md", path: dir });
    expect(getTextContent(result).toLowerCase()).toContain("no files found");
  });

  it("treats character-class patterns gracefully instead of crashing (report 1.12)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "[Cc]onfig" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });

  it("treats a prefix-only wildcard that matches nothing gracefully (report 1.13)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "config*" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });

  it("treats a '.*' pattern gracefully (report 1.18)", async () => {
    writeFileSync(join(dir, ".env"), "x");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: ".*" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });

  it("bare name + path that matches nothing is friendly, not a crash (report 1.19)", async () => {
    mkdirSync(join(dir, "baresync"), { recursive: true });
    writeFileSync(join(dir, "baresync", "package.json"), "{}");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "baresync*", path: "baresync" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });
});
