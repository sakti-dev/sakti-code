import { describe, expect, it } from "vitest";
import {
  modelDescriptorSchema,
  providerAuthStateSchema,
  providerConfigPayloadSchema,
  providerDescriptorSchema,
} from "../../src/provider/schema";

describe("provider domain schemas", () => {
  it("parses ProviderDescriptor with opencode-style fields", () => {
    const parsed = providerDescriptorSchema.parse({
      id: "zai",
      name: "Z.AI",
      env: ["ZAI_API_KEY"],
      api: true,
      models: true,
      auth: {
        kind: "token",
      },
    });

    expect(parsed.id).toBe("zai");
    expect(parsed.env).toContain("ZAI_API_KEY");
    expect(parsed.auth.kind).toBe("token");
  });

  it("parses ProviderAuthState", () => {
    const parsed = providerAuthStateSchema.parse({
      providerId: "openai",
      status: "connected",
      method: "token",
      accountLabel: "personal",
      updatedAt: "2026-02-14T11:00:00.000Z",
    });

    expect(parsed.status).toBe("connected");
    expect(parsed.method).toBe("token");
  });

  it("parses ModelDescriptor", () => {
    const parsed = modelDescriptorSchema.parse({
      id: "zai/glm-4.5",
      name: "GLM-4.5",
      providerId: "zai",
      providerName: "Z.AI",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: {
        text: true,
        vision: true,
        tools: true,
        reasoning: true,
        plan: false,
      },
    });

    expect(parsed.providerId).toBe("zai");
    expect(parsed.capabilities.vision).toBe(true);
  });

  it("parses ProviderConfigPayload", () => {
    const parsed = providerConfigPayloadSchema.parse({
      providers: [
        {
          id: "zai",
          name: "Z.AI",
          env: ["ZAI_API_KEY"],
          api: true,
          models: true,
          auth: { kind: "token" },
        },
      ],
      auth: {
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      },
      models: [
        {
          id: "zai/glm-4.5",
          name: "GLM-4.5",
          providerId: "zai",
          providerName: "Z.AI",
          contextWindow: 128000,
          maxOutputTokens: 8192,
          capabilities: {
            text: true,
            vision: true,
            tools: true,
            reasoning: true,
            plan: false,
          },
        },
      ],
    });

    expect(parsed.providers).toHaveLength(1);
    expect(parsed.models[0]?.id).toBe("zai/glm-4.5");
  });
});
