import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SaktiCodeApiClient questions API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits question replies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const result = await client.replyQuestion("question-1", "Comprehensive");

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/questions/reply");

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "question-1",
      reply: "Comprehensive",
    });
  });

  it("submits question rejection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const result = await client.rejectQuestion("question-2", "skip");

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/questions/reject");

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "question-2",
      reason: "skip",
    });
  });
});
