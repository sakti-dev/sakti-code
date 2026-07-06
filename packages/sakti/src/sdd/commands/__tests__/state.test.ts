import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import * as yaml from "yaml";
import { writeChangeMetadata } from "../../utils/change-metadata.js";
import { stateGet, stateSet, stateTransition } from "../state.js";
import type { ChangeMetadata } from "../../core/change-metadata/index.js";

describe("stateGet", () => {
  let tmpDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-state-${randomUUID()}`);
    changeDir = path.join(tmpDir, ".sakti", "changes", "test-change");
    await fs.mkdir(changeDir, { recursive: true });
    writeChangeMetadata(
      changeDir,
      { schema: "spec-driven", created: "2026-07-06", workflow: "full", phase: "open" },
      tmpDir,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads an existing field value", async () => {
    const value = await stateGet(changeDir, "phase");
    expect(value).toBe("open");
  });

  it("reads workflow field", async () => {
    const value = await stateGet(changeDir, "workflow");
    expect(value).toBe("full");
  });

  it("throws on unknown field", async () => {
    await expect(stateGet(changeDir, "bogus_field")).rejects.toThrow(/unknown field/i);
  });
});

describe("stateSet", () => {
  let tmpDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-state-set-${randomUUID()}`);
    changeDir = path.join(tmpDir, ".sakti", "changes", "test-change");
    await fs.mkdir(changeDir, { recursive: true });
    writeChangeMetadata(
      changeDir,
      { schema: "spec-driven", created: "2026-07-06", workflow: "full", phase: "open" },
      tmpDir,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a field value and persists to .sakti.yaml", async () => {
    await stateSet(changeDir, "build_mode", "direct", { projectRoot: tmpDir });
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    expect(parsed.build_mode).toBe("direct");
  });

  it("validates enum values — rejects invalid build_mode", async () => {
    await expect(
      stateSet(changeDir, "build_mode", "bogus", { projectRoot: tmpDir }),
    ).rejects.toThrow();
  });

  it("blocks direct phase writes without --force", async () => {
    await expect(stateSet(changeDir, "phase", "build", { projectRoot: tmpDir })).rejects.toThrow(
      /transition/i,
    );
  });

  it("allows direct phase writes with force flag", async () => {
    await stateSet(changeDir, "phase", "build", { projectRoot: tmpDir, force: true });
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    expect(parsed.phase).toBe("build");
  });

  it("sets nullable field to null when value is 'null'", async () => {
    await stateSet(changeDir, "build_pause", "plan-ready", { projectRoot: tmpDir });
    await stateSet(changeDir, "build_pause", "null", { projectRoot: tmpDir });
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    expect(parsed.build_pause).toBeNull();
  });
});

describe("stateTransition", () => {
  let tmpDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-transition-${randomUUID()}`);
    changeDir = path.join(tmpDir, ".sakti", "changes", "test-change");
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function seed(workflow: "full" | "hotfix" | "tweak", phase: string, extra?: object): void {
    writeChangeMetadata(
      changeDir,
      {
        schema: "spec-driven",
        created: "2026-07-06",
        workflow,
        phase,
        ...extra,
      } as ChangeMetadata,
      tmpDir,
    );
  }

  async function readField(field: string): Promise<unknown> {
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    return parsed[field];
  }

  it("open-complete advances to design for full workflow when artifacts exist", async () => {
    seed("full", "open");
    await fs.writeFile(path.join(changeDir, "proposal.md"), "# proposal");
    await fs.writeFile(path.join(changeDir, "design.md"), "# design");
    await fs.writeFile(path.join(changeDir, "tasks.md"), "# tasks");

    await stateTransition(changeDir, "open-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("design");
  });

  it("open-complete advances to build for hotfix workflow", async () => {
    seed("hotfix", "open");
    await fs.writeFile(path.join(changeDir, "proposal.md"), "# proposal");
    await fs.writeFile(path.join(changeDir, "tasks.md"), "# tasks");

    await stateTransition(changeDir, "open-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("build");
  });

  it("open-complete fails when artifacts are missing", async () => {
    seed("full", "open");
    await expect(
      stateTransition(changeDir, "open-complete", { projectRoot: tmpDir }),
    ).rejects.toThrow(/proposal|design|tasks/i);
  });

  it("open-complete fails when phase is not open", async () => {
    seed("full", "design");
    await expect(
      stateTransition(changeDir, "open-complete", { projectRoot: tmpDir }),
    ).rejects.toThrow(/phase/i);
  });

  it("design-complete requires design_doc", async () => {
    seed("full", "design");
    await expect(
      stateTransition(changeDir, "design-complete", { projectRoot: tmpDir }),
    ).rejects.toThrow(/design_doc/i);
  });

  it("design-complete advances to build when design_doc is set", async () => {
    seed("full", "design", { design_doc: "docs/design.md" });
    await stateTransition(changeDir, "design-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("build");
  });

  it("build-complete advances to verify", async () => {
    seed("full", "build");
    await stateTransition(changeDir, "build-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("verify");
    expect(await readField("verify_result")).toBe("pending");
  });

  it("verify-pass requires verification_report and branch_status=handled", async () => {
    seed("full", "verify");
    await expect(
      stateTransition(changeDir, "verify-pass", { projectRoot: tmpDir }),
    ).rejects.toThrow(/verification_report|branch_status/i);
  });

  it("verify-pass advances to archive when evidence present", async () => {
    seed("full", "verify", {
      verification_report: "reports/v.md",
      branch_status: "handled",
    });
    await stateTransition(changeDir, "verify-pass", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("archive");
    expect(await readField("verify_result")).toBe("pass");
  });

  it("verify-fail rolls back to build", async () => {
    seed("full", "verify");
    await stateTransition(changeDir, "verify-fail", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("build");
    expect(await readField("verify_result")).toBe("fail");
  });

  it("archived requires verify_result=pass", async () => {
    seed("full", "archive", { verify_result: "pending" });
    await expect(stateTransition(changeDir, "archived", { projectRoot: tmpDir })).rejects.toThrow(
      /verify_result/i,
    );
  });

  it("archived sets archived=true when verify_result=pass", async () => {
    seed("full", "archive", { verify_result: "pass" });
    await stateTransition(changeDir, "archived", { projectRoot: tmpDir });
    expect(await readField("archived")).toBe(true);
  });
});
