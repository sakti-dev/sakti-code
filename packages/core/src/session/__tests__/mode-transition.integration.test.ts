/**
 * Tests for Mode Transition Orchestrator
 *
 * Tests verify:
 * - no-op transitions return 'noop' (intake -> intake, build -> build, plan -> plan)
 * - invalid target (to = "explore") returns 'invalid' and no writes
 * - denied approval returns 'denied' and no writes
 * - approved transition writes mode and returns 'approved'
 * - concurrent transitions for same session serialize deterministically
 * - intake -> plan and plan -> build are allowed
 * - intake -> build is not allowed
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

async function insertTestSession(db: any, sessionId: string) {
  const { sql } = await import("drizzle-orm");
  await db.run(
    sql`INSERT INTO task_sessions (session_id, resource_id, thread_id, title, created_at, last_accessed, status, session_kind) VALUES (${sessionId}, 'test', ${sessionId}, 'Test Session', ${new Date()}, ${new Date()}, 'researching', 'task')`
  );
}

describe("Mode Transition Orchestrator", () => {
  let transitionSessionMode: typeof import("@/session/mode-transition").transitionSessionMode;
  let getSessionRuntimeMode: typeof import("@/spec/helpers").getSessionRuntimeMode;
  let updateSessionRuntimeMode: typeof import("@/spec/helpers").updateSessionRuntimeMode;

  beforeEach(async () => {
    const modeTransition = await import("@/session/mode-transition");
    transitionSessionMode = modeTransition.transitionSessionMode;

    const helpers = await import("@/spec/helpers");
    getSessionRuntimeMode = helpers.getSessionRuntimeMode;
    updateSessionRuntimeMode = helpers.updateSessionRuntimeMode;

    const { getDb } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    await db.run(
      sql`DELETE FROM tool_sessions WHERE tool_name = 'spec' AND tool_key = 'runtimeMode'`
    );
    await db.run(sql`DELETE FROM task_sessions`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("transitionSessionMode", () => {
    it("should return noop for intake -> intake (same mode)", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);
      await updateSessionRuntimeMode(sessionId, "intake");

      const result = await transitionSessionMode({
        sessionId,
        from: "intake",
        to: "intake",
      });

      expect(result.outcome).toBe("noop");
    });

    it("should return noop for build -> build (same mode)", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);
      await updateSessionRuntimeMode(sessionId, "build");

      const result = await transitionSessionMode({
        sessionId,
        from: "build",
        to: "build",
      });

      expect(result.outcome).toBe("noop");
    });

    it("should return noop for plan -> plan (same mode)", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);
      await updateSessionRuntimeMode(sessionId, "plan");

      const result = await transitionSessionMode({
        sessionId,
        from: "plan",
        to: "plan",
      });

      expect(result.outcome).toBe("noop");
    });

    it("should return invalid for to = 'explore'", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);

      const result = await transitionSessionMode({
        sessionId,
        from: "build",
        to: "explore" as "intake" | "plan" | "build",
      });

      expect(result.outcome).toBe("invalid");
      expect(result.error).toContain("invalid target mode");
    });

    it("should return invalid for intake -> build (direct transition not allowed)", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);
      await updateSessionRuntimeMode(sessionId, "intake");

      const result = await transitionSessionMode({
        sessionId,
        from: "intake",
        to: "build",
      });

      expect(result.outcome).toBe("invalid");
      expect(result.error).toContain("invalid transition");
    });

    it("should approve intake -> plan transition", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);
      await updateSessionRuntimeMode(sessionId, "intake");

      const mockApprove = vi.fn().mockResolvedValue(true);

      const result = await transitionSessionMode({
        sessionId,
        from: "intake",
        to: "plan",
        approvalCallback: mockApprove,
      });

      expect(result.outcome).toBe("approved");
      expect(await getSessionRuntimeMode(sessionId)).toBe("plan");
    });

    it("should return denied when approval callback rejects", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);

      const mockApprove = vi.fn().mockResolvedValue(false);

      const result = await transitionSessionMode({
        sessionId,
        from: "build",
        to: "plan",
        approvalCallback: mockApprove,
      });

      expect(result.outcome).toBe("denied");
      expect(mockApprove).toHaveBeenCalled();
      expect(await getSessionRuntimeMode(sessionId)).toBeNull();
    });

    it("should return approved and write mode when approved", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);

      const mockApprove = vi.fn().mockResolvedValue(true);

      const result = await transitionSessionMode({
        sessionId,
        from: "build",
        to: "plan",
        approvalCallback: mockApprove,
      });

      expect(result.outcome).toBe("approved");
      expect(await getSessionRuntimeMode(sessionId)).toBe("plan");
    });

    it("should serialize concurrent transitions for same session", async () => {
      const sessionId = uuidv7();
      const { getDb } = await import("@/testing/db");
      const db = await getDb();

      await insertTestSession(db, sessionId);

      let approvalCallCount = 0;
      const approvalResults: boolean[] = [];

      const mockApprove = vi.fn().mockImplementation(async () => {
        approvalCallCount++;
        const currentCount = approvalCallCount;
        await new Promise(resolve => setTimeout(resolve, 50));
        const result = currentCount === 1;
        approvalResults.push(result);
        return result;
      });

      await Promise.all([
        transitionSessionMode({
          sessionId,
          from: "build",
          to: "plan",
          approvalCallback: mockApprove,
        }),
        transitionSessionMode({
          sessionId,
          from: "plan",
          to: "build",
          approvalCallback: mockApprove,
        }),
      ]);

      expect(mockApprove).toHaveBeenCalledTimes(2);
      expect(approvalResults).toContain(true);
      expect(await getSessionRuntimeMode(sessionId)).toBe("plan");
    });
  });
});
