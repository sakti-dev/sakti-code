import { describe, expect, it } from "vitest";

import { taskSessions } from "../../db/schema";

describe("task_sessions schema", () => {
  it("exposes renamed table export", () => {
    expect(taskSessions).toBeDefined();
    expect(taskSessions.session_id).toBeDefined();
  });

  it("includes workflow columns", () => {
    expect(taskSessions.status).toBeDefined();
    expect(taskSessions.spec_type).toBeDefined();
    expect(taskSessions.last_activity_at).toBeDefined();
  });
});
