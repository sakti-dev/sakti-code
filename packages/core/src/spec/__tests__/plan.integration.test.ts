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

vi.mock("@/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (...args: unknown[]) => mockRequestApproval(...args),
      getRules: vi.fn(() => []),
    })),
  },
}));

vi.mock("@/security/permission-rules", () => ({
  evaluatePermission: vi.fn(() => "allow"),
}));

describe("Plan Tools", () => {
  let planEnterTool: typeof import("@/tools/plan").planEnterTool;
  let planExitTool: typeof import("@/tools/plan").planExitTool;
  let planEnterExecute: NonNullable<typeof import("@/tools/plan").planEnterTool.execute>;
  let planExitExecute: NonNullable<typeof import("@/tools/plan").planExitTool.execute>;
  let updateSessionSpec: typeof import("@/spec/helpers").updateSessionSpec;
  let getCurrentTask: typeof import("@/spec/helpers").getCurrentTask;
  let Instance: typeof import("@/instance").Instance;

  type PlanToolOptions = Parameters<
    NonNullable<typeof import("@/tools/plan").planEnterTool.execute>
  >[1];

  const testSessionId = `test-plan-session-${uuidv7()}`;
  const testWorkspaceDir = path.join("/tmp", "sakti-code-test-plan", uuidv7());
  const toolOptions: PlanToolOptions = { toolCallId: "plan-tool-call", messages: [] };

  beforeEach(async () => {
    vi.clearAllMocks();

    const plan = await import("@/tools/plan");
    planEnterTool = plan.planEnterTool;
    planExitTool = plan.planExitTool;
    planEnterExecute = planEnterTool.execute as NonNullable<typeof planEnterTool.execute>;
    planExitExecute = planExitTool.execute as NonNullable<typeof planExitTool.execute>;

    const helpers = await import("@/spec/helpers");
    updateSessionSpec = helpers.updateSessionSpec;
    getCurrentTask = helpers.getCurrentTask;

    const instanceModule = await import("@/instance");
    Instance = instanceModule.Instance;

    const { getDb, sessions } = await import("@/testing/db");
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
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("plan_enter", () => {
    it("should reject invalid spec_slug format (uppercase)", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const result = (await planEnterExecute(
            { spec_slug: "User-Auth", description: "Test spec" },
            toolOptions
          )) as { error?: string };

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
          const result = (await planEnterExecute(
            { spec_slug: "user_auth!", description: "Test spec" },
            toolOptions
          )) as { error?: string };

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
          const result = (await planEnterExecute(
            { spec_slug: "user-auth", description: "User authentication" },
            toolOptions
          )) as { error?: string };

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
          await planEnterExecute(
            { spec_slug: "user-auth", description: "User authentication" },
            toolOptions
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
          await planEnterExecute(
            { spec_slug: "user-auth", description: "User authentication" },
            toolOptions
          );

          const { getActiveSpec } = await import("@/spec/helpers");
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
          const result = (await planEnterExecute(
            { spec_slug: "test-spec", description: "Test" },
            toolOptions
          )) as { error?: string; spec_slug?: string; spec_path?: string };

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
          await expect(planExitExecute({ summary: "Test plan" }, toolOptions)).rejects.toThrow(
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

          await expect(planExitExecute({ summary: "Test plan" }, toolOptions)).rejects.toThrow(
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

          await expect(planExitExecute({ summary: "Test plan" }, toolOptions)).rejects.toThrow(
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

          await expect(planExitExecute({ summary: "Test plan" }, toolOptions)).rejects.toThrow(
            "cycle"
          );
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

          await expect(planExitExecute({ summary: "Test plan" }, toolOptions)).rejects.toThrow(
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

          const result = (await planExitExecute({ summary: "Test plan" }, toolOptions)) as {
            status: string;
            next_task: string | null;
          };
          expect(result.status).toBe("Plan compiled to database");
          expect(result.next_task).toBe("T-001");
          await expect(getCurrentTask(testSessionId)).resolves.toBe("T-001");
        },
      });
    });
  });
});
