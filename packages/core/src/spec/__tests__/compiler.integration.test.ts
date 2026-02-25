/**
 * Tests for Spec Compiler
 *
 * Phase 2 - Spec System Tests
 * Tests verify:
 * - compileSpecToDb: Compiles tasks.md to DB tasks with metadata
 */

import { promises as fs } from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

interface SpecTaskMeta {
  taskId?: string;
  slug?: string;
  requirements?: string[];
}

function getSpecMeta(metadata: unknown): SpecTaskMeta | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const spec = (metadata as { spec?: unknown }).spec;
  if (!spec || typeof spec !== "object") return undefined;
  return spec as SpecTaskMeta;
}

describe("Spec Compiler", () => {
  let compileSpecToDb: typeof import("@/spec/compiler").compileSpecToDb;
  let tempDir: string;

  beforeEach(async () => {
    const compiler = await import("@/spec/compiler");
    compileSpecToDb = compiler.compileSpecToDb;

    tempDir = path.join(
      "/tmp",
      `compiler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(tempDir, { recursive: true });

    // Clean up tasks and tool_sessions from previous test runs
    const { getDb } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM tasks`);
    await db.run(sql`DELETE FROM tool_sessions WHERE tool_name = 'spec'`);
    await db.run(sql`DELETE FROM task_sessions`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("compileSpecToDb", () => {
    it("should create tasks in database from tasks.md", async () => {
      // Create requirements.md
      const requirementsContent = `# Requirements: user-auth

## Acceptance Criteria

### R-001
**When** user visits login, **then** they see login form.

### R-002
**When** user submits valid credentials, **then** they are logged in.
`;
      await fs.writeFile(path.join(tempDir, "requirements.md"), requirementsContent);

      // Create tasks.md
      const tasksContent = `# Tasks: user-auth

## Implementation Tasks

### T-001 — Implement login page
**Maps to requirements:** R-001

**Outcome:** Login page created

**Dependencies:**

### T-002 — Implement auth API
**Maps to requirements:** R-002

**Outcome:** Auth API created

**Dependencies:** T-001
`;
      await fs.writeFile(path.join(tempDir, "tasks.md"), tasksContent);

      const result = await compileSpecToDb(tempDir, "user-auth");

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify tasks in DB
      const { listTasksBySpec } = await import("@/spec/helpers");
      const tasks = await listTasksBySpec("user-auth");

      expect(tasks).toHaveLength(2);
      const t1 = tasks.find(t => getSpecMeta(t.metadata)?.taskId === "T-001");
      const t1Spec = getSpecMeta(t1?.metadata);
      expect(t1).toBeDefined();
      expect(t1?.title).toBe("Implement login page");
      expect(t1?.status).toBe("open");
      expect(t1Spec?.slug).toBe("user-auth");
      expect(t1Spec?.requirements).toEqual(["R-001"]);
    });

    it("should update existing tasks on re-compilation", async () => {
      // Create requirements.md
      await fs.writeFile(
        path.join(tempDir, "requirements.md"),
        `# Requirements: user-auth

### R-001
**When** user visits login, **then** they see login form.
`
      );

      // Create tasks.md first time
      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Original title
**Maps to requirements:** R-001

**Outcome:** Original outcome
`
      );

      // First compile
      await compileSpecToDb(tempDir, "user-auth");

      // Update tasks.md
      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Updated title
**Maps to requirements:** R-001

**Outcome:** Updated outcome
`
      );

      // Second compile
      const result = await compileSpecToDb(tempDir, "user-auth");

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      const { listTasksBySpec } = await import("@/spec/helpers");
      const tasks = await listTasksBySpec("user-auth");

      expect(tasks[0].title).toBe("Updated title");
    });

    it("should validate that all requirements exist in requirements.md", async () => {
      // Create requirements.md with only R-001
      await fs.writeFile(
        path.join(tempDir, "requirements.md"),
        `# Requirements: user-auth

### R-001
**When** user visits login, **then** they see login form.
`
      );

      // Create tasks.md with R-001 and R-002
      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Task with valid requirement
**Maps to requirements:** R-001

**Outcome:** Done

**Dependencies:**

### T-002 — Task with invalid requirement
**Maps to requirements:** R-002

**Outcome:** Done

**Dependencies:**
`
      );

      const result = await compileSpecToDb(tempDir, "user-auth");

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Invalid requirements");
      expect(result.created).toBe(1); // Only T-001 created
    });

    it("should validate that dependencies reference valid tasks", async () => {
      await fs.writeFile(
        path.join(tempDir, "requirements.md"),
        `# Requirements: user-auth

### R-001
**When** user visits login, **then** they see login form.
`
      );

      // Create tasks.md with invalid dependency
      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Task
**Maps to requirements:** R-001

**Outcome:** Done

**Dependencies:** T-999
`
      );

      const result = await compileSpecToDb(tempDir, "user-auth");

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Invalid dependencies");
    });

    it("should create task dependencies in junction table", async () => {
      await fs.writeFile(
        path.join(tempDir, "requirements.md"),
        `# Requirements: user-auth

### R-001
**When** user visits login, **then** they see login form.

### R-002
**When** user submits credentials, **then** they are authenticated.
`
      );

      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Login page
**Maps to requirements:** R-001

**Outcome:** Login page

**Dependencies:**

### T-002 — Auth API
**Maps to requirements:** R-002

**Outcome:** Auth API

**Dependencies:** T-001
`
      );

      await compileSpecToDb(tempDir, "user-auth");

      // Verify dependencies in DB
      const { getTaskBySpecAndId } = await import("@/spec/helpers");
      const t2 = await getTaskBySpecAndId("user-auth", "T-002");

      const { getDb } = await import("@/testing/db");
      const { taskDependencies } = await import("@/testing/db");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();

      const deps = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.task_id, t2!.id));

      expect(deps).toHaveLength(1);
      expect(deps[0].type).toBe("blocks");
    });

    it("should be idempotent (safe to run multiple times)", async () => {
      await fs.writeFile(
        path.join(tempDir, "requirements.md"),
        `# Requirements: user-auth

### R-001
**When** user visits login, **then** they see login form.
`
      );

      // First compile
      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Original title
**Maps to requirements:** R-001

**Outcome:** Original outcome
`
      );

      const result1 = await compileSpecToDb(tempDir, "user-auth");

      // Second compile - with changed content
      await fs.writeFile(
        path.join(tempDir, "tasks.md"),
        `# Tasks: user-auth

### T-001 — Updated title
**Maps to requirements:** R-001

**Outcome:** Updated outcome
`
      );

      const result2 = await compileSpecToDb(tempDir, "user-auth");

      // Third compile - same as second, should not update
      const result3 = await compileSpecToDb(tempDir, "user-auth");

      expect(result1.created).toBe(1);
      expect(result2.created).toBe(0);
      expect(result2.updated).toBe(1);
      expect(result3.created).toBe(0);
      expect(result3.updated).toBe(0);
    });
  });
});
