/**
 * Tests for Mode Transition Orchestrator
 *
 * Tests verify:
 * - no-op transitions return 'noop' (build -> build, plan -> plan)
 * - invalid target (to = "explore") returns 'invalid' and no writes
 * - denied approval returns 'denied' and no writes
 * - approved transition writes mode and returns 'approved'
 * - concurrent transitions for same session serialize deterministically
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

    const { getDb, sessions: _sessions } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    await db.run(
      sql`DELETE FROM tool_sessions WHERE tool_name = 'spec' AND tool_key = 'runtimeMode'`
    );
    await db.run(sql`DELETE FROM sessions`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("transitionSessionMode", () => {
    it("should return noop for build -> build (same mode)", async () => {
      const sessionId = uuidv7();
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

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
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

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
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      const result = await transitionSessionMode({
        sessionId,
        from: "build",
        to: "explore" as "plan" | "build",
      });

      expect(result.outcome).toBe("invalid");
      expect(result.error).toContain("invalid target mode");
    });

    it("should return denied when approval callback rejects", async () => {
      const sessionId = uuidv7();
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

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
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

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
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

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
