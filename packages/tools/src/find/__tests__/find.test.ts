import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@sakti-code/agent";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  buildPathNotFoundMessage,
  classifyRgExitCode,
  createFindTool,
  resolveGlobPattern,
} from "../index.ts";

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
    expect(getTextContent(result).toLowerCase()).toContain("no files found");
  });

  it("treats a prefix-only wildcard that matches nothing gracefully (report 1.13)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "config*" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
    expect(getTextContent(result).toLowerCase()).toContain("no files found");
  });

  it("treats a '.*' pattern gracefully (report 1.18)", async () => {
    writeFileSync(join(dir, ".env"), "x");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: ".*" });
    // '.*' is a real glob that matches the dotfile, so the positive outcome is
    // the matched file (not the friendly empty message).
    expect(getTextContent(result)).not.toContain("rg exited with code");
    expect(getTextContent(result)).toContain(".env");
  });

  it("bare name + path that matches nothing is friendly, not a crash (report 1.19)", async () => {
    mkdirSync(join(dir, "baresync"), { recursive: true });
    writeFileSync(join(dir, "baresync", "package.json"), "{}");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "baresync*", path: "baresync" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
    expect(getTextContent(result).toLowerCase()).toContain("no files found");
  });
});

describe("find: abort prevents partial results from leaking", () => {
  // Regression guard for the load-bearing post-runList abort gate: runProcess
  // finalizes a SIGKILL'd rg as exit 0, so without the `signal?.aborted` check
  // between runList() and formatFindResults the partial/empty stdout would be
  // formatted as a (wrong) file list. This uses the production branch (no
  // customOps) to exercise real runProcess + that gate.
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-abort-"));
    for (let i = 0; i < 200; i++) writeFileSync(join(dir, `f${i}.ts`), "x");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("throws 'Operation aborted' rather than returning a partial file list", async () => {
    const tool = createFindTool(dir);
    const ac = new AbortController();
    // Abort after kicking off execute. ac.abort() runs synchronously on the
    // main thread before any rg IO callback / await continuation can reach
    // formatFindResults, so the post-runList gate deterministically throws.
    const run = tool.execute("tc", { pattern: "*.ts" }, ac.signal);
    ac.abort();
    await expect(run).rejects.toThrow(/aborted/i);
  });
});

describe("find: buildPathNotFoundMessage (pure)", () => {
  it("includes the missing path verbatim", () => {
    const msg = buildPathNotFoundMessage("/x/y/missing", null);
    expect(msg).toContain("Path not found: /x/y/missing");
  });

  it("does not mention raw OS errors", () => {
    const msg = buildPathNotFoundMessage("/x/y/missing", null);
    expect(msg).not.toContain("os error");
    expect(msg).not.toContain("IO error");
  });

  it("lists up to 20 parent entries when parent exists", () => {
    const entries = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
    const msg = buildPathNotFoundMessage("/d/missing", entries);
    expect(msg).toContain("f0.ts");
    expect(msg).toContain("f19.ts");
    expect(msg).toContain("more"); // "... (N more)" suffix
    expect(msg).not.toContain("f20.ts"); // 21st omitted
  });

  it("surfaces up to 5 similar entries (case-insensitive)", () => {
    const entries = [
      "Config.ts",
      "conf.ts",
      "Configuration.ts",
      "config.json",
      "my-config.ts",
      "extra.ts",
    ];
    const msg = buildPathNotFoundMessage("/d/config", entries);
    expect(msg).toContain("Did you mean");
    expect(msg).toContain("Config.ts");
    expect(msg).toContain("config.json");
  });

  it("omits the 'did you mean' line when nothing is similar", () => {
    const msg = buildPathNotFoundMessage("/d/zzz", ["alpha.ts", "beta.ts"]);
    expect(msg).not.toContain("Did you mean");
  });

  it("omits the listing when parent is null", () => {
    const msg = buildPathNotFoundMessage("/d/zzz", null);
    expect(msg).not.toContain("Entries in");
  });
});

describe("find: missing path raises a friendly error (report 1.9)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-path-"));
    writeFileSync(join(dir, "alpha.ts"), "x");
    writeFileSync(join(dir, "alfred.ts"), "x");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects with 'Path not found', not a raw OS error", async () => {
    const tool = createFindTool(dir);
    await expect(tool.execute("tc", { pattern: "*.ts", path: "does-not-exist" })).rejects.toThrow(
      /Path not found/,
    );
  });

  it("the error message contains no raw OS error text", async () => {
    const tool = createFindTool(dir);
    await expect(tool.execute("tc", { pattern: "*.ts", path: "no-such-dir" })).rejects.toSatisfy(
      (err: Error) => !err.message.includes("os error") && !err.message.includes("IO error"),
    );
  });

  it("suggests similar entries when the parent exists", async () => {
    const tool = createFindTool(dir);
    await expect(tool.execute("tc", { pattern: "*.ts", path: "alp" })).rejects.toThrow(
      /Did you mean.*alpha\.ts|alfred\.ts/,
    );
  });

  it("does not false-positive on an existing path", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "*.ts", path: "." });
    expect(getTextContent(result)).toContain("alpha.ts");
  });

  it("works for an absolute non-existent path", async () => {
    const tool = createFindTool(dir);
    await expect(
      tool.execute("tc", { pattern: "*.ts", path: "/definitely/not/here" }),
    ).rejects.toThrow(/Path not found/);
  });
});
