import { describe, expect, it } from "vitest";
import { listProviderAuthMethods } from "../../auth/registry";

describe("provider auth registry", () => {
  it("exposes oauth methods for openai and github-copilot", () => {
    const methods = listProviderAuthMethods(["openai", "github-copilot"]);

    expect(methods.openai?.some(method => method.type === "oauth")).toBe(true);
    expect(methods.openai?.filter(method => method.type === "oauth")).toHaveLength(2);
    expect(methods.openai?.[0]?.label).toBe("ChatGPT Pro/Plus (browser)");
    expect(methods.openai?.[1]?.label).toBe("ChatGPT Pro/Plus (headless)");
    expect(methods.openai?.some(method => method.type === "api")).toBe(true);
    expect(methods.openai?.find(method => method.type === "api")?.label).toBe(
      "Manually enter API Key"
    );
    expect(methods["github-copilot"]?.some(method => method.type === "oauth")).toBe(true);
  });

  it("returns api-only methods for zai, zai-coding-plan, and opencode", () => {
    const methods = listProviderAuthMethods(["zai", "zai-coding-plan", "opencode"]);
    expect(methods.zai).toEqual([{ type: "api", label: "API Key", prompts: undefined }]);
    expect(methods["zai-coding-plan"]).toEqual([
      { type: "api", label: "API Key", prompts: undefined },
    ]);
    expect(methods.opencode).toEqual([{ type: "api", label: "API Key", prompts: undefined }]);
  });

  it("returns oauth-capable methods only for openai/github-copilot", () => {
    const methods = listProviderAuthMethods(["openai", "github-copilot", "anthropic"]);
    expect(methods.openai.some(m => m.type === "oauth")).toBe(true);
    expect(methods["github-copilot"].some(m => m.type === "oauth")).toBe(true);
    expect(methods.anthropic.every(m => m.type === "api")).toBe(true);
  });
});
