import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SaktiCodeApiClient provider/model payload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("includes selected provider and model from chat options in request", async () => {
    localStorage.setItem("sakti-code:selected-provider", "zai");
    localStorage.setItem("sakti-code:selected-model", "zai/glm-4.7");

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
      providerId: "openai",
      modelId: "openai/gpt-4o-mini",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(body.providerId).toBe("openai");
    expect(body.modelId).toBe("openai/gpt-4o-mini");
  });
});
