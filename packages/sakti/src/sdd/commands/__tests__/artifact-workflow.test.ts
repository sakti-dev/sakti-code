import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { runCLI } from "../../../__tests__/helpers/run-cli.js";
import { FileSystemUtils } from "../../utils/file-system.js";

describe("artifact-workflow CLI commands", () => {
  let tempDir: string;
  let changesDir: string;

  const canonical = (targetPath: string): string =>
    FileSystemUtils.canonicalizeExistingPath(targetPath);

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sakti-artifact-workflow-"));
    changesDir = path.join(tempDir, ".sakti", "changes");
    await fs.mkdir(changesDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Gets combined output from CLI result (ora outputs to stdout).
   */
  function getOutput(result: { stdout: string; stderr: string }): string {
    return result.stdout + result.stderr;
  }

  /**
   * Normalizes path separators to forward slashes for cross-platform assertions.
   */
  function normalizePaths(str: string): string {
    return str.replace(/\\/g, "/");
  }

  /**
   * Creates a test change with the specified artifacts completed.
   * Note: An "active" change requires at least a proposal.md file to be detected.
   * If no artifacts are specified, we create an empty proposal to make it detectable.
   */
  async function createTestChange(
    changeName: string,
    artifacts: ("proposal" | "design" | "specs" | "tasks")[] = [],
  ): Promise<string> {
    const changeDir = path.join(changesDir, changeName);
    await fs.mkdir(changeDir, { recursive: true });

    // Always create proposal.md for the change to be detected as active
    // Content varies based on whether 'proposal' is in artifacts list
    const proposalContent = artifacts.includes("proposal")
      ? "## Why\nTest proposal content that is long enough.\n\n## What Changes\n- **test:** Something"
      : "## Why\nMinimal proposal.\n\n## What Changes\n- **test:** Placeholder";
    await fs.writeFile(path.join(changeDir, "proposal.md"), proposalContent);

    if (artifacts.includes("design")) {
      await fs.writeFile(path.join(changeDir, "design.md"), "# Design\n\nTechnical design.");
    }

    if (artifacts.includes("specs")) {
      // specs artifact uses glob pattern "specs/*.md" - files directly in specs/ directory
      const specsDir = path.join(changeDir, "specs");
      await fs.mkdir(specsDir, { recursive: true });
      await fs.writeFile(path.join(specsDir, "test-spec.md"), "## Purpose\nTest spec.");
    }

    if (artifacts.includes("tasks")) {
      await fs.writeFile(path.join(changeDir, "tasks.md"), "## Tasks\n- [ ] Task 1");
    }

    return changeDir;
  }

  describe("status command", () => {
    it("shows status for scaffolded change without proposal.md", async () => {
      // Create empty change directory (no proposal.md)
      const changeDir = path.join(changesDir, "scaffolded-change");
      await fs.mkdir(changeDir, { recursive: true });

      const result = await runCLI(["status", "--change", "scaffolded-change"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("scaffolded-change");
      expect(result.stdout).toContain("0/4 artifacts complete");
    });

    it("shows status for a change with proposal only", async () => {
      // createTestChange always creates proposal.md, so this has 1 artifact complete
      await createTestChange("minimal-change");

      const result = await runCLI(["status", "--change", "minimal-change"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("minimal-change");
      expect(result.stdout).toContain("spec-driven");
      expect(result.stdout).toContain("1/4 artifacts complete");
    });

    it("shows status for a change with proposal and design", async () => {
      await createTestChange("partial-change", ["proposal", "design"]);

      const result = await runCLI(["status", "--change", "partial-change"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("2/4 artifacts complete");
      expect(result.stdout).toContain("[x]");
    });

    it("outputs JSON when --json flag is used", async () => {
      await createTestChange("json-change", ["proposal", "design"]);

      const result = await runCLI(["status", "--change", "json-change", "--json"], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");

      const json = JSON.parse(result.stdout);
      expect(json.changeName).toBe("json-change");
      expect(json.schemaName).toBe("spec-driven");
      expect(json.isComplete).toBe(false);
      expect(Array.isArray(json.artifacts)).toBe(true);
      expect(json.artifacts).toHaveLength(4);

      const proposalArtifact = json.artifacts.find((a: any) => a.id === "proposal");
      expect(proposalArtifact.status).toBe("done");
    });

    it("shows complete status when all artifacts are done", async () => {
      await createTestChange("complete-change", ["proposal", "design", "specs", "tasks"]);

      const result = await runCLI(["status", "--change", "complete-change"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("4/4 artifacts complete");
      expect(result.stdout).toContain("All artifacts complete!");
    });

    it("exits gracefully when no changes exist", async () => {
      const result = await runCLI(["status"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No active changes");
      expect(result.stdout).toContain("sakti new change");
    });

    it("exits gracefully with JSON when no changes exist", async () => {
      const result = await runCLI(["status", "--json"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.changes).toEqual([]);
      expect(json.message).toBe("No active changes.");
    });

    it("errors when --change is missing and lists available changes", async () => {
      await createTestChange("some-change");

      const result = await runCLI(["status"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Missing required option --change");
      expect(output).toContain("some-change");
    });

    it("errors for unknown change name and lists available changes", async () => {
      await createTestChange("existing-change");

      const result = await runCLI(["status", "--change", "nonexistent"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Change 'nonexistent' not found");
      expect(output).toContain("existing-change");
    });

    it("supports --schema option", async () => {
      await createTestChange("schema-change");

      const result = await runCLI(
        ["status", "--change", "schema-change", "--schema", "spec-driven"],
        {
          cwd: tempDir,
        },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("spec-driven");
    });

    it("errors for unknown schema", async () => {
      await createTestChange("test-change");

      const result = await runCLI(["status", "--change", "test-change", "--schema", "unknown"], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Schema 'unknown' not found");
    });

    it("rejects path traversal in change name", async () => {
      const result = await runCLI(["status", "--change", "../foo"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Invalid change name");
    });

    it("rejects absolute path in change name", async () => {
      const result = await runCLI(["status", "--change", "/etc/passwd"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Invalid change name");
    });

    it("rejects slashes in change name", async () => {
      const result = await runCLI(["status", "--change", "foo/bar"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Invalid change name");
    });
  });

  describe("new change command", () => {
    it("creates a new change directory", async () => {
      const result = await runCLI(["new", "change", "my-new-feature"], { cwd: tempDir });
      expect(result.exitCode).toBe(0);
      const output = getOutput(result);
      expect(output).toContain("Created change 'my-new-feature'");

      const changeDir = path.join(changesDir, "my-new-feature");
      const stat = await fs.stat(changeDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("rejects --initiative and writes no change", async () => {
      const result = await runCLI(
        ["new", "change", "linked-change", "--initiative", "billing-launch"],
        { cwd: tempDir },
      );
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("--initiative is no longer supported");
      await expect(fs.stat(path.join(changesDir, "linked-change"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("rejects --areas and writes no affected-area metadata", async () => {
      const result = await runCLI(["new", "change", "area-change", "--areas", "api"], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("--areas is no longer supported");
      await expect(fs.stat(path.join(changesDir, "area-change"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("keeps --goal as ordinary metadata without switching schema", async () => {
      const result = await runCLI(["new", "change", "goal-change", "--goal", "Improve billing"], {
        cwd: tempDir,
      });
      expect(result.exitCode).toBe(0);

      const metadata = await fs.readFile(
        path.join(changesDir, "goal-change", ".sakti.yaml"),
        "utf-8",
      );
      expect(metadata).toContain("schema: spec-driven");
      expect(metadata).toContain("goal: Improve billing");
      expect(metadata).not.toContain("affected_areas");
      expect(metadata).not.toContain("initiative");
    });

    it("creates README.md when --description is provided", async () => {
      const result = await runCLI(
        ["new", "change", "described-feature", "--description", "This is a test feature"],
        { cwd: tempDir },
      );
      expect(result.exitCode).toBe(0);

      const readmePath = path.join(changesDir, "described-feature", "README.md");
      const content = await fs.readFile(readmePath, "utf-8");
      expect(content).toContain("described-feature");
      expect(content).toContain("This is a test feature");
    });

    it("errors for invalid change name with spaces", async () => {
      const result = await runCLI(["new", "change", "invalid name"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("Error");
    });

    it("errors for duplicate change name", async () => {
      await createTestChange("existing-change");

      const result = await runCLI(["new", "change", "existing-change"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
      const output = getOutput(result);
      expect(output).toContain("exists");
    });

    it("errors when name argument is missing", async () => {
      const result = await runCLI(["new", "change"], { cwd: tempDir });
      expect(result.exitCode).toBe(1);
    });
  });

  describe("help text", () => {
    it("status command help shows description", async () => {
      const result = await runCLI(["status", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Display artifact completion status");
    });

    it("new command help shows description", async () => {
      const result = await runCLI(["new", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Create new items");
    });
  });

  describe("project config integration", () => {
    describe("new change uses config schema", () => {
      it("creates change with schema from project config", async () => {
        // Create project config with spec-driven schema
        // Note: changesDir is already at tempDir/sakti/changes (created in beforeEach)
        await fs.writeFile(path.join(tempDir, ".sakti", "config.yaml"), "schema: spec-driven\n");

        // Create a new change without specifying schema
        const result = await runCLI(["new", "change", "test-change"], {
          cwd: tempDir,
          timeoutMs: 30000,
        });
        expect(result.exitCode).toBe(0);

        // Verify the change was created with spec-driven schema
        const metadataPath = path.join(changesDir, "test-change", ".sakti.yaml");
        const metadata = await fs.readFile(metadataPath, "utf-8");
        expect(metadata).toContain("schema: spec-driven");
      }, 60000);

      it("CLI schema overrides config schema", async () => {
        // Create project config with spec-driven schema
        // Note: sakti directory already exists (from changesDir creation in beforeEach)
        await fs.writeFile(path.join(tempDir, ".sakti", "config.yaml"), "schema: spec-driven\n");

        // Create change with explicit schema
        const result = await runCLI(["new", "change", "override-test", "--schema", "spec-driven"], {
          cwd: tempDir,
          timeoutMs: 30000,
        });
        expect(result.exitCode).toBe(0);

        // Verify the change uses the CLI-specified schema
        const metadataPath = path.join(changesDir, "override-test", ".sakti.yaml");
        const metadata = await fs.readFile(metadataPath, "utf-8");
        expect(metadata).toContain("schema: spec-driven");
      }, 60000);
    });

    describe("backwards compatibility", () => {
      it("existing changes work without config file", async () => {
        // Create change without any config file
        await createTestChange("no-config-change", ["proposal"]);

        // Status command should work
        const statusResult = await runCLI(["status", "--change", "no-config-change"], {
          cwd: tempDir,
          timeoutMs: 30000,
        });
        expect(statusResult.exitCode).toBe(0);
        expect(statusResult.stdout).toContain("no-config-change");
        expect(statusResult.stdout).toContain("spec-driven"); // Default schema
      }, 60000);

      it("changes with metadata work without config file", async () => {
        // Create change with explicit schema in metadata
        const changeDir = await createTestChange("metadata-only-change");
        await fs.writeFile(
          path.join(changeDir, ".sakti.yaml"),
          'schema: spec-driven\ncreated: "2025-01-05"\n',
        );

        // Status should use schema from metadata
        const result = await runCLI(["status", "--change", "metadata-only-change"], {
          cwd: tempDir,
          timeoutMs: 30000,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("spec-driven");
      }, 60000);
    });
  });
});
