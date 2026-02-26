import { describe, expect, it } from "vitest";

import { taskSessionRuns } from "../schema";

describe("task_session_runs schema", () => {
  it("exposes run state/lease/idempotency columns", () => {
    expect(taskSessionRuns).toBeDefined();
    expect(taskSessionRuns.run_id).toBeDefined();
    expect(taskSessionRuns.task_session_id).toBeDefined();
    expect(taskSessionRuns.runtime_mode).toBeDefined();
    expect(taskSessionRuns.state).toBeDefined();
    expect(taskSessionRuns.client_request_key).toBeDefined();
    expect(taskSessionRuns.lease_owner).toBeDefined();
    expect(taskSessionRuns.lease_expires_at).toBeDefined();
    expect(taskSessionRuns.last_heartbeat_at).toBeDefined();
    expect(taskSessionRuns.cancel_requested_at).toBeDefined();
    expect(taskSessionRuns.finished_at).toBeDefined();
  });
});
