import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentContext } from "../context-loader.ts";

describe("loadAgentContext", () => {
  const origEnv = process.env.SAKTI_AGENT_DIR;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.SAKTI_AGENT_DIR;
    } else {
      process.env.SAKTI_AGENT_DIR = origEnv;
    }
  });

  it("loads commands, agents, and skills from global + project config dirs", async () => {
    const globalDir = mkdtempSync(join(tmpdir(), "sakti-global-"));
    const projectDir = mkdtempSync(join(tmpdir(), "sakti-proj-"));
    process.env.SAKTI_AGENT_DIR = globalDir;

    mkdirSync(join(globalDir, "commands"), { recursive: true });
    writeFileSync(
      join(globalDir, "commands", "global-cmd.md"),
      "---\ndescription: global command\n---\nglobal body"
    );

    mkdirSync(join(projectDir, ".agents", "commands"), { recursive: true });
    writeFileSync(
      join(projectDir, ".agents", "commands", "proj-cmd.md"),
      "---\ndescription: project command\n---\nproject body"
    );
    mkdirSync(join(projectDir, ".agents", "agents"), { recursive: true });
    writeFileSync(
      join(projectDir, ".agents", "agents", "scout.md"),
      "---\nmode: subagent\ndescription: scout\n---\nscout prompt"
    );
    mkdirSync(join(projectDir, ".agents", "skills", "eff"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".agents", "skills", "eff", "SKILL.md"),
      "---\nname: eff\ndescription: eff skill\n---\neff content"
    );

    const ctx = await loadAgentContext(projectDir);

    expect(ctx.commands.map((c) => c.name).sort()).toEqual([
      "global-cmd",
      "proj-cmd",
    ]);
    expect(ctx.agents.map((a) => a.name)).toEqual(["scout"]);
    expect(ctx.skills.map((s) => s.name)).toEqual(["eff"]);
  });

  it("returns empty lists when no config dirs contain anything", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "sakti-empty-"));
    process.env.SAKTI_AGENT_DIR = mkdtempSync(join(tmpdir(), "sakti-empty-g-"));

    const ctx = await loadAgentContext(projectDir);

    expect(ctx.commands).toEqual([]);
    expect(ctx.agents).toEqual([]);
    expect(ctx.skills).toEqual([]);
  });
});
