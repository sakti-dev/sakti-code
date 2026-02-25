import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SaktiCodeApiClient runtimeMode payload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("includes runtimeMode in chat request body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    await client.chat([{ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] }], {
      workspace: "/repo",
      runtimeMode: "intake",
    });

    const call = fetchSpy.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(body.runtimeMode).toBe("intake");
  });
});
