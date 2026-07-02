import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildApp } from "../app.ts";
import { makeContext } from "./helpers.ts";

describe("context routes", () => {
  const origEnv = process.env.SAKTI_AGENT_DIR;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.SAKTI_AGENT_DIR;
    } else {
      process.env.SAKTI_AGENT_DIR = origEnv;
    }
  });

  it("GET /api/projects/:id/context returns commands, skills, and agents", async () => {
    process.env.SAKTI_AGENT_DIR = mkdtempSync(join(tmpdir(), "sakti-ctx-g-"));
    const { ctx } = await makeContext();
    const projectDir = mkdtempSync(join(tmpdir(), "sakti-ctx-p-"));
    mkdirSync(join(projectDir, ".agents", "commands"), { recursive: true });
    writeFileSync(
      join(projectDir, ".agents", "commands", "commit.md"),
      "---\ndescription: commit and push\n---\ncommit body",
    );
    mkdirSync(join(projectDir, ".agents", "skills", "lint"), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, ".agents", "skills", "lint", "SKILL.md"),
      "---\ndescription: lint the repo\n---\nlint body",
    );
    mkdirSync(join(projectDir, ".agents", "agents"), { recursive: true });
    writeFileSync(
      join(projectDir, ".agents", "agents", "scout.md"),
      "---\nmode: subagent\ndescription: scout\n---\nscout prompt",
    );
    const project = await ctx.repos.projects.create("p", projectDir);

    const app = buildApp(ctx);
    const res = await app.request(`http://localhost:3001/api/projects/${project.id}/context`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.commands.map((c: { name: string }) => c.name)).toEqual(["compact", "commit"]);
    expect(body.commands[0]).toMatchObject({
      name: "compact",
      description: expect.stringContaining("Compact"),
    });
    expect(body.commands[1]).toMatchObject({
      name: "commit",
      description: "commit and push",
      content: "commit body",
    });
    expect(body.skills.map((s: { name: string }) => s.name)).toEqual(["lint"]);
    expect(body.agents.map((a: { name: string }) => a.name)).toEqual(["scout"]);
    expect(body.agents[0]).toMatchObject({ mode: "subagent" });
  });

  it("returns 404 for an unknown project", async () => {
    process.env.SAKTI_AGENT_DIR = mkdtempSync(join(tmpdir(), "sakti-ctx-g3-"));
    const { ctx } = await makeContext();
    const app = buildApp(ctx);
    const res = await app.request("http://localhost:3001/api/projects/nope/context");
    expect(res.status).toBe(404);
  });
});
