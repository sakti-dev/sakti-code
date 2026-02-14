import { afterEach, describe, expect, it } from "vitest";
import { OpenAIProviderAdapter } from "../../src/provider/adapters/openai";

describe("OpenAIProviderAdapter", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("describes provider metadata", () => {
    const adapter = new OpenAIProviderAdapter();

    const descriptor = adapter.describe();
    expect(descriptor.id).toBe("openai");
    expect(descriptor.env).toContain("OPENAI_API_KEY");
    expect(descriptor.auth.kind).toBe("token");
  });

  it("returns disconnected auth state without credentials", async () => {
    const adapter = new OpenAIProviderAdapter();
    const state = await adapter.getAuthState();

    expect(state.status).toBe("disconnected");
  });

  it("returns connected auth state with env token", async () => {
    process.env.OPENAI_API_KEY = "env-token";
    const adapter = new OpenAIProviderAdapter();
    const state = await adapter.getAuthState();

    expect(state.status).toBe("connected");
  });

  it("lists canonical openai models", async () => {
    const adapter = new OpenAIProviderAdapter();
    const models = await adapter.listModels();

    expect(models.some(model => model.id === "openai/gpt-4o")).toBe(true);
    expect(models.some(model => model.id === "openai/gpt-4o-mini")).toBe(true);
  });
});
