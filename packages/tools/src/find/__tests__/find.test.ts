import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@sakti-code/agent";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFindTool, resolveGlobPattern } from "../index.ts";

function getTextContent(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  if (first && "text" in first) {
    return first.text;
  }
  return "";
}

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
