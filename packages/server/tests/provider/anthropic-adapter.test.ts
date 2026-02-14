import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProviderAdapter } from "../../src/provider/adapters/anthropic";

describe("AnthropicProviderAdapter", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("describes provider metadata", () => {
    const adapter = new AnthropicProviderAdapter();

    const descriptor = adapter.describe();
    expect(descriptor.id).toBe("anthropic");
    expect(descriptor.env).toContain("ANTHROPIC_API_KEY");
    expect(descriptor.auth.kind).toBe("token");
  });

  it("returns disconnected auth state without credentials", async () => {
    const adapter = new AnthropicProviderAdapter();
    const state = await adapter.getAuthState();

    expect(state.status).toBe("disconnected");
  });

  it("returns connected auth state with env token", async () => {
    process.env.ANTHROPIC_API_KEY = "env-token";
    const adapter = new AnthropicProviderAdapter();
    const state = await adapter.getAuthState();

    expect(state.status).toBe("connected");
  });

  it("lists canonical anthropic models", async () => {
    const adapter = new AnthropicProviderAdapter();
    const models = await adapter.listModels();

    expect(models.some(model => model.id === "anthropic/claude-3-7-sonnet-latest")).toBe(true);
  });
});
