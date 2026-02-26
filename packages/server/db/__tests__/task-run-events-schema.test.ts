import { describe, expect, it } from "vitest";

import { taskRunEvents } from "../schema";

describe("task_run_events schema", () => {
  it("exposes run event ordering columns", () => {
    expect(taskRunEvents).toBeDefined();
    expect(taskRunEvents.event_id).toBeDefined();
    expect(taskRunEvents.run_id).toBeDefined();
    expect(taskRunEvents.task_session_id).toBeDefined();
    expect(taskRunEvents.event_seq).toBeDefined();
    expect(taskRunEvents.event_type).toBeDefined();
    expect(taskRunEvents.payload).toBeDefined();
    expect(taskRunEvents.created_at).toBeDefined();
  });
});
