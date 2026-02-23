import { describe, expect, it } from "vitest";
import { createBuiltinProviderAuthDefinitions } from "../../providers";

describe("provider auth definitions", () => {
  it("does not register zai, zai-coding-plan, or opencode in builtins", () => {
    const definitions = createBuiltinProviderAuthDefinitions();
    const providerIds = definitions.map(definition => definition.providerId);

    expect(providerIds).not.toContain("zai");
    expect(providerIds).not.toContain("zai-coding-plan");
    expect(providerIds).not.toContain("opencode");
  });

  it("only registers oauth-capable providers in builtins", () => {
    const definitions = createBuiltinProviderAuthDefinitions();
    const providerIds = definitions.map(definition => definition.providerId);

    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("github-copilot");
    expect(providerIds).toContain("anthropic");
  });
});
