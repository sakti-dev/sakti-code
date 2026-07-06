import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runCLI, type RunCLIResult } from "../../../__tests__/helpers/run-cli.js";

describe("sakti doctor", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "sakti-doctor-")));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  function makeProject(schemaName?: string): string {
    const projectRoot = path.join(tempDir, "my-project");
    const saktiDir = path.join(projectRoot, ".sakti");
    fs.mkdirSync(saktiDir, { recursive: true });
    if (schemaName !== undefined) {
      fs.writeFileSync(path.join(saktiDir, "config.yaml"), `schema: ${schemaName}\n`, "utf-8");
    }
    return projectRoot;
  }

  it("reports healthy for a project with valid config and resolvable schema", async () => {
    const projectRoot = makeProject("spec-driven");
    process.chdir(projectRoot);

    const result = await runCLI(["doctor", "--json"], { cwd: projectRoot });

    expect(result.exitCode).toBe(0);
    const report = parseJson(result);
    expect(report.root.found).toBe(true);
    expect(report.config.present).toBe(true);
    expect(report.config.valid).toBe(true);
    expect(report.config.schemaName).toBe("spec-driven");
    expect(report.schema.resolvable).toBe(true);
    expect(report.healthy).toBe(true);
  });

  it("reports root not found when run outside a sakti project", async () => {
    const result = await runCLI(["doctor", "--json"], { cwd: tempDir });

    expect(result.exitCode).toBe(1);
    const report = parseJson(result);
    expect(report.root.found).toBe(false);
    expect(report.healthy).toBe(false);
  });

  it("reports a config error when schema field is missing", async () => {
    const projectRoot = path.join(tempDir, "no-schema-project");
    fs.mkdirSync(path.join(projectRoot, ".sakti"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".sakti", "config.yaml"),
      "context: a project without a schema field\n",
      "utf-8",
    );

    const result = await runCLI(["doctor", "--json"], { cwd: projectRoot });

    expect(result.exitCode).toBe(1);
    const report = parseJson(result);
    expect(report.config.present).toBe(true);
    expect(report.config.valid).toBe(false);
    expect(report.healthy).toBe(false);
    const configErrors = report.config.findings.filter((f: any) => f.level === "error");
    expect(configErrors.length).toBeGreaterThan(0);
  });

  it("reports a schema error for an unknown schema name", async () => {
    const projectRoot = makeProject("does-not-exist");
    process.chdir(projectRoot);

    const result = await runCLI(["doctor", "--json"], { cwd: projectRoot });

    expect(result.exitCode).toBe(1);
    const report = parseJson(result);
    expect(report.config.valid).toBe(true);
    expect(report.schema.resolvable).toBe(false);
    expect(report.healthy).toBe(false);
    const schemaErrors = report.schema.findings.filter((f: any) => f.level === "error");
    expect(schemaErrors.length).toBeGreaterThan(0);
  });

  it("prints a human-readable report", async () => {
    const projectRoot = makeProject("spec-driven");
    process.chdir(projectRoot);

    const result = await runCLI(["doctor"], { cwd: projectRoot });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Doctor");
    expect(result.stdout).toContain("Root");
    expect(result.stdout).toContain("Config");
    expect(result.stdout).toContain("Schema");
    expect(result.stdout).toContain("healthy");
  });

  it("prints a root-not-found message in human mode", async () => {
    const result = await runCLI(["doctor"], { cwd: tempDir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("No .sakti/");
  });
});
