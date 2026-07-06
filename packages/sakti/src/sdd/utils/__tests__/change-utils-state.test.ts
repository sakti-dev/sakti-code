import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import * as yaml from "yaml";
import { execSync } from "child_process";
import { createChange } from "../change-utils.js";

describe("createChange state machine integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-test-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes full-workflow state defaults to .sakti.yaml", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });

    const result = await createChange(tmpDir, "add-auth", { workflow: "full" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.workflow).toBe("full");
    expect(parsed.phase).toBe("open");
    expect(parsed.auto_transition).toBe(true);
    expect(parsed.build_mode).toBeNull();
    expect(parsed.verify_result).toBe("pending");
    expect(parsed.archived).toBe(false);
  });

  it("writes hotfix state defaults when workflow is hotfix", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });

    const result = await createChange(tmpDir, "fix-typo", { workflow: "hotfix" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.workflow).toBe("hotfix");
    expect(parsed.build_mode).toBe("direct");
    expect(parsed.tdd_mode).toBe("direct");
    expect(parsed.isolation).toBe("branch");
    expect(parsed.verify_mode).toBe("light");
  });

  it("defaults to full workflow when no workflow specified", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });

    const result = await createChange(tmpDir, "add-feature");
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.workflow).toBe("full");
  });

  it("captures base_ref as current git HEAD SHA", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, "README.md"), "init");
    execSync("git add .", { cwd: tmpDir });
    execSync("git commit -m init", { cwd: tmpDir });
    const headSha = execSync("git rev-parse HEAD", { cwd: tmpDir }).toString().trim();

    const result = await createChange(tmpDir, "add-auth", { workflow: "full" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.base_ref).toBe(headSha);
  });

  it("sets base_ref to null when not in a git repo", async () => {
    const result = await createChange(tmpDir, "add-auth", { workflow: "full" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.base_ref).toBeNull();
  });
});
