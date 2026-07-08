import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("returns an error (no terminate) when to=mission and the tree is dirty outside .sakti/changes", async () => {
    execSync("git init -b main", { cwd: dir, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd: dir, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd: dir, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd: dir, shell: "/bin/sh" });
    execSync(`mkdir -p ${dir}/src`, { shell: "/bin/sh" });
    execSync(`echo oops > ${dir}/src/dirty.ts`, { shell: "/bin/sh" });
    const tools = buildAgentTools(["transition"], makeCtx(dir));
    const result = await tools[0]!.execute("call-1", { to: "mission", body: "brief" } as never);
    expect(result.terminate).toBe(false);
    expect(
      result.content[0] &&
        result.content[0].type === "text" &&
        result.content[0].text.toLowerCase(),
    ).toContain("clean");
  });

  it("mission transition with unrelated dirty paths returns actionable stash opt-in guidance", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sakti-transition-dirty-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    mkdirSync(join(cwd, ".sakti/changes/add-feature"), { recursive: true });
    writeFileSync(join(cwd, ".sakti/changes/add-feature/.sakti.yaml"), "name: add-feature\n");
    writeFileSync(join(cwd, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src/dirty.ts"), "dirty\n");
    try {
      const tools = buildAgentTools(["transition"], { cwd } as never);
      const tool = tools[0]!;

      const result = await tool.execute(
        {} as never,
        {
          to: "mission",
          body: "brief",
        } as never,
      );

      expect(result.terminate).toBe(false);
      expect(result.content[0]?.type).toBe("text");
      const txt = result.content[0];
      expect(txt?.type === "text" ? txt.text : "").toContain('preserveUnrelated: "stash"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("mission transition with preserveUnrelated stashes unrelated paths and proceeds", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sakti-transition-stash-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    mkdirSync(join(cwd, ".sakti/changes/add-feature"), { recursive: true });
    writeFileSync(join(cwd, ".sakti/changes/add-feature/.sakti.yaml"), "name: add-feature\n");
    writeFileSync(join(cwd, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src/dirty.ts"), "dirty\n");
    try {
      const tools = buildAgentTools(["transition"], { cwd } as never);
      const tool = tools[0]!;

      const result = await tool.execute(
        {} as never,
        {
          to: "mission",
          body: "brief",
          preserveUnrelated: "stash",
        } as never,
      );

      expect(result.terminate).toBe(true);
      expect(existsSync(join(cwd, "src/dirty.ts"))).toBe(false);
      expect(existsSync(join(cwd, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
      expect(
        execSync("git stash list --format=%s -1", {
          cwd,
          shell: "/bin/sh",
        }).toString(),
      ).toContain("sakti: preserve unrelated changes before mission add-feature");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
