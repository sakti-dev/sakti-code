import { beforeEach, describe, expect, it } from "vitest";
import { resolveChatSelection } from "../../src/provider/runtime";

describe("chat provider selection", () => {
  beforeEach(() => {
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("resolves defaults when provider/model not provided", () => {
    const selection = resolveChatSelection({});

    expect(selection.providerId).toBe("zai");
    expect(selection.modelId).toBe("zai/glm-4.7");
    expect(selection.explicit).toBe(false);
  });

  it("keeps explicit provider/model selection", () => {
    const selection = resolveChatSelection({ providerId: "zai", modelId: "zai/glm-4.6v" });

    expect(selection.providerId).toBe("zai");
    expect(selection.modelId).toBe("zai/glm-4.6v");
    expect(selection.explicit).toBe(true);
  });

  it("returns 401 when explicit provider is unauthenticated", async () => {
    const chatRouter = (await import("../../src/routes/chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "hello",
        providerId: "zai",
        modelId: "zai/glm-4.7",
        stream: false,
      }),
    });

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error?.code).toBe("PROVIDER_UNAUTHENTICATED");
    expect(String(payload.error?.message)).toContain("not authenticated");
  });
});
