import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SaktiCodeApiClient project keypoints API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists keypoints by workspace", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ keypoints: [{ id: "kp-1" }] }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const keypoints = await client.listProjectKeypoints("ws-1");
    expect(keypoints).toEqual([{ id: "kp-1" }]);

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/project-keypoints?workspaceId=ws-1"
    );
  });

  it("creates a keypoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ keypoint: { id: "kp-2", milestone: "started" } }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const created = await client.createProjectKeypoint({
      workspaceId: "ws-1",
      taskSessionId: "ts-1",
      taskTitle: "Task",
      milestone: "started",
      summary: "Started task",
      artifacts: ["spec.md"],
    });

    expect(created).toEqual({ id: "kp-2", milestone: "started" });
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect((init as RequestInit).method).toBe("POST");
  });
});
