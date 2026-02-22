/**
 * Tests for Plan Tools (plan_enter and plan_exit)
 *
 * Phase 3 - Spec System Tests
 * Tests verify:
 * - plan_enter: Creates spec directory, template files, sets active spec
 * - plan_exit: Validates tasks.md, DAG, compiles to DB
 */

import { promises as fs } from "fs";
import path from "path";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestApproval } = vi.hoisted(() => ({
  mockRequestApproval: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (...args: unknown[]) => mockRequestApproval(...args),
      getRules: vi.fn(() => []),
    })),
  },
}));

vi.mock("../../src/security/permission-rules", () => ({
  evaluatePermission: vi.fn(() => "allow"),
}));

describe("Plan Tools", () => {
  let planEnterTool: ReturnType<typeof import("../../src/tools/plan").planEnterTool>;
  let planExitTool: ReturnType<typeof import("../../src/tools/plan").planExitTool>;
  let updateSessionSpec: typeof import("../../src/spec/helpers").updateSessionSpec;
  let getCurrentTask: typeof import("../../src/spec/helpers").getCurrentTask;
  let Instance: typeof import("../../src/instance").Instance;

  const testSessionId = `test-plan-session-${uuidv7()}`;
  const testWorkspaceDir = path.join("/tmp", "sakti-code-test-plan", uuidv7());

  beforeEach(async () => {
    vi.clearAllMocks();

    const plan = await import("../../src/tools/plan");
    planEnterTool = plan.planEnterTool;
    planExitTool = plan.planExitTool;

    const helpers = await import("../../src/spec/helpers");
    updateSessionSpec = helpers.updateSessionSpec;
    getCurrentTask = helpers.getCurrentTask;

    const instanceModule = await import("../../src/instance");
    Instance = instanceModule.Instance;

    const { getDb, sessions } = await import("@sakti-code/core/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    await db.run(sql`DELETE FROM tool_sessions WHERE tool_name = 'spec'`);
    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM tasks`);

    await db
      .insert(sessions)
      .values({
        session_id: testSessionId,
        resource_id: "test",
        thread_id: testSessionId,
        title: "Test Plan Session",
        created_at: new Date(),
        last_accessed: new Date(),
      })
      .onConflictDoNothing();

    await fs.mkdir(testWorkspaceDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(path.dirname(testWorkspaceDir), { recursive: true, force: true });
    } catch {}
    const { closeDb } = await import("@sakti-code/core/testing/db");
    closeDb();
  });

  describe("plan_enter", () => {
    it("should reject invalid spec_slug format (uppercase)", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const result = await planEnterTool.execute(
            { spec_slug: "User-Auth", description: "Test spec" },
            {}
          );

          expect(result.error).toContain("spec_slug must be lowercase");
        },
      });
    });

    it("should reject invalid spec_slug format (special chars)", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const result = await planEnterTool.execute(
            { spec_slug: "user_auth!", description: "Test spec" },
            {}
          );

          expect(result.error).toContain("spec_slug must be lowercase");
        },
      });
    });

    it("should create spec directory structure", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const result = await planEnterTool.execute(
            { spec_slug: "user-auth", description: "User authentication" },
            {}
          );

          expect(result.error).toBeUndefined();

          const specDir = path.join(testWorkspaceDir, ".kiro", "specs", "user-auth");
          const dirExists = await fs
            .access(specDir)
            .then(() => true)
            .catch(() => false);
          expect(dirExists).toBe(true);
        },
      });
    });

    it("should create template files (requirements.md, design.md, tasks.md, correctness.md)", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await planEnterTool.execute(
            { spec_slug: "user-auth", description: "User authentication" },
            {}
          );

          const specDir = path.join(testWorkspaceDir, ".kiro", "specs", "user-auth");

          const reqExists = await fs
            .access(path.join(specDir, "requirements.md"))
            .then(() => true)
            .catch(() => false);
          const designExists = await fs
            .access(path.join(specDir, "design.md"))
            .then(() => true)
            .catch(() => false);
          const tasksExists = await fs
            .access(path.join(specDir, "tasks.md"))
            .then(() => true)
            .catch(() => false);
          const correctExists = await fs
            .access(path.join(specDir, "correctness.md"))
            .then(() => true)
            .catch(() => false);

          expect(reqExists).toBe(true);
          expect(designExists).toBe(true);
          expect(tasksExists).toBe(true);
          expect(correctExists).toBe(true);
        },
      });
    });

    it("should set active spec in session", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await planEnterTool.execute(
            { spec_slug: "user-auth", description: "User authentication" },
            {}
          );

          const { getActiveSpec } = await import("../../src/spec/helpers");
          const activeSpec = await getActiveSpec(testSessionId);
          expect(activeSpec).toBe("user-auth");
        },
      });
    });

    it("should include slug and path in response", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const result = await planEnterTool.execute(
            { spec_slug: "test-spec", description: "Test" },
            {}
          );

          expect(result.error).toBeUndefined();
          expect(result.spec_slug).toBe("test-spec");
          expect(result.spec_path).toContain(".kiro/specs/test-spec");
        },
      });
    });
  });

  describe("plan_exit", () => {
    it("should throw error when no active spec", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await expect(planExitTool.execute({ summary: "Test plan" }, {})).rejects.toThrow(
            "No active spec"
          );
        },
      });
    });

    it("should throw error when tasks.md is missing", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await updateSessionSpec(testSessionId, "nonexistent-spec");

          await expect(planExitTool.execute({ summary: "Test plan" }, {})).rejects.toThrow(
            /(tasks\.md not found|No tasks found in tasks\.md)/
          );
        },
      });
    });

    it("should throw error when T-### has no R-### mapping", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const specDir = path.join(testWorkspaceDir, ".kiro", "specs", "user-auth");
          await fs.mkdir(specDir, { recursive: true });

          await fs.writeFile(
            path.join(specDir, "requirements.md"),
            `# Requirements: user-auth

### R-001
**When** user visits page, **then** show login form.
`
          );

          await fs.writeFile(
            path.join(specDir, "tasks.md"),
            `# Tasks: user-auth

### T-001 — Do something
**Outcome:** Something gets done

### T-002 — Do another thing
**Maps to requirements:** R-001

**Outcome:** Another thing gets done
`
          );

          await updateSessionSpec(testSessionId, "user-auth");

          await expect(planExitTool.execute({ summary: "Test plan" }, {})).rejects.toThrow(
            "without R-### mapping"
          );
        },
      });
    });

    it("should throw error when DAG has cycles", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const specDir = path.join(testWorkspaceDir, ".kiro", "specs", "user-auth");
          await fs.mkdir(specDir, { recursive: true });

          await fs.writeFile(
            path.join(specDir, "requirements.md"),
            `# Requirements: user-auth

### R-001
**When** user visits page, **then** show login form.
`
          );

          await fs.writeFile(
            path.join(specDir, "tasks.md"),
            `# Tasks: user-auth

### T-001 — Task A
**Maps to requirements:** R-001

**Outcome:** Task A done
**Dependencies:** T-002

### T-002 — Task B
**Maps to requirements:** R-001

**Outcome:** Task B done
**Dependencies:** T-001
`
          );

          await updateSessionSpec(testSessionId, "user-auth");

          await expect(planExitTool.execute({ summary: "Test plan" }, {})).rejects.toThrow("cycle");
        },
      });
    });

    it("should throw error when compilation reports spec validation errors", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const specDir = path.join(testWorkspaceDir, ".kiro", "specs", "user-auth");
          await fs.mkdir(specDir, { recursive: true });

          await fs.writeFile(
            path.join(specDir, "requirements.md"),
            `# Requirements: user-auth

### R-001
**When** user visits page, **then** show login form.
`
          );

          await fs.writeFile(
            path.join(specDir, "tasks.md"),
            `# Tasks: user-auth

### T-001 — Task A
**Maps to requirements:** R-999

**Outcome:** Task A done
**Dependencies:**
`
          );

          await updateSessionSpec(testSessionId, "user-auth");

          await expect(planExitTool.execute({ summary: "Test plan" }, {})).rejects.toThrow(
            "Compilation failed"
          );
        },
      });
    });

    it("should set the current task to the first ready task after compile", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const specDir = path.join(testWorkspaceDir, ".kiro", "specs", "user-auth");
          await fs.mkdir(specDir, { recursive: true });

          await fs.writeFile(
            path.join(specDir, "requirements.md"),
            `# Requirements: user-auth

### R-001
**When** user visits page, **then** show login form.
`
          );

          await fs.writeFile(
            path.join(specDir, "tasks.md"),
            `# Tasks: user-auth

### T-001 — Task A
**Maps to requirements:** R-001

**Outcome:** Task A done
**Dependencies:**
`
          );

          await updateSessionSpec(testSessionId, "user-auth");

          const result = await planExitTool.execute({ summary: "Test plan" }, {});
          expect(result.status).toBe("Plan compiled to database");
          expect(result.next_task).toBe("T-001");
          await expect(getCurrentTask(testSessionId)).resolves.toBe("T-001");
        },
      });
    });
  });
});
