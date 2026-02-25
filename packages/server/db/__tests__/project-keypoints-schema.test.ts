import { describe, expect, it } from "vitest";
import { projectKeypoints } from "../../db/schema";

describe("project_keypoints schema", () => {
  it("has expected columns", () => {
    expect(projectKeypoints.id).toBeDefined();
    expect(projectKeypoints.workspace_id).toBeDefined();
    expect(projectKeypoints.task_session_id).toBeDefined();
    expect(projectKeypoints.milestone).toBeDefined();
    expect(projectKeypoints.artifacts).toBeDefined();
  });
});
