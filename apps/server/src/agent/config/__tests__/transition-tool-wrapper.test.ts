import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildAgentTools, type ToolContext } from "../tool-registry.ts";

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    editMode: "normal" as never,
    noopOwner: {},
    snapshotStore: {} as never,
  };
}

describe("transition tool wrapper", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-tt-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an error (no terminate) when to=mission and cwd is not a git repo", async () => {
    const tools = buildAgentTools(["transition"], makeCtx(dir));
    const result = await tools[0]!.execute("call-1", { to: "mission", body: "brief" });
    expect(result.terminate).toBe(false);
    const text = result.content[0];
    expect(text?.type === "text" && text.text.toLowerCase()).toContain("git");
  });

  it("terminates normally when to=mission and cwd is a git repo", () => {
    execSync("git init -b main", { cwd: dir, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd: dir, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd: dir, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd: dir, shell: "/bin/sh" });
    return Promise.resolve().then(async () => {
      const tools = buildAgentTools(["transition"], makeCtx(dir));
      const result = await tools[0]!.execute("call-1", { to: "mission", body: "brief" });
      expect(result.terminate).toBe(true);
    });
  });

  it("always terminates normally for non-mission destinations (no pre-flight)", async () => {
    const tools = buildAgentTools(["transition"], makeCtx(dir));
    const result = await tools[0]!.execute("call-1", { to: "build", body: "spec" });
    expect(result.terminate).toBe(true);
  });
});
