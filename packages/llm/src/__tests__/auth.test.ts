import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../auth/env.ts";
import type { AuthResult, ModelAuth } from "../auth/types.ts";

describe("getEnvApiKey", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns OPENAI_API_KEY value for openai provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-openai");
    expect(getEnvApiKey("openai")).toBe("sk-test-openai");
  });

  it("returns ANTHROPIC_OAUTH_TOKEN when both oauth token and api key are set (precedence)", () => {
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "oauth-token-value");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthropic");
    expect(getEnvApiKey("anthropic")).toBe("oauth-token-value");
  });

  it("returns ANTHROPIC_API_KEY when oauth token is unset", () => {
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthropic");
    expect(getEnvApiKey("anthropic")).toBe("sk-anthropic");
  });

  it("returns undefined for an unknown provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(getEnvApiKey("not-a-real-provider")).toBeUndefined();
  });

  it("returns COPILOT_GITHUB_TOKEN for github-copilot", () => {
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "ghu_copilot");
    expect(getEnvApiKey("github-copilot")).toBe("ghu_copilot");
  });

  it("returns ZAI_API_KEY for zai", () => {
    vi.stubEnv("ZAI_API_KEY", "zai-key");
    expect(getEnvApiKey("zai")).toBe("zai-key");
  });

  it("scoped env param takes precedence over process.env", () => {
    vi.stubEnv("OPENAI_API_KEY", "from-process-env");
    expect(getEnvApiKey("openai", { OPENAI_API_KEY: "from-scoped-env" })).toBe(
      "from-scoped-env"
    );
  });

  it("returns undefined when no env var is set for a known provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(getEnvApiKey("openai")).toBeUndefined();
  });
});

describe("findEnvKeys", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns all configured env vars for anthropic when both are set", () => {
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "oauth-value");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-value");
    expect(findEnvKeys("anthropic")).toEqual([
      "ANTHROPIC_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("returns only the set var when one of several is configured", () => {
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-value");
    expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("returns undefined for an unknown provider", () => {
    expect(findEnvKeys("not-a-real-provider")).toBeUndefined();
  });
});

describe("auth result types", () => {
  it("ModelAuth carries apiKey, headers, baseUrl", () => {
    const auth: ModelAuth = {
      apiKey: "sk-test",
      baseUrl: "https://custom.example.com",
      headers: { "X-Custom": "value", "X-Suppressed": null },
    };
    expect(auth.apiKey).toBe("sk-test");
    expectTypeOf(auth).toEqualTypeOf<ModelAuth>();
  });

  it("AuthResult wraps ModelAuth with optional env + source label", () => {
    const result: AuthResult = {
      auth: { apiKey: "sk-test" },
      env: { REGION: "us-east-1" },
      source: "OPENAI_API_KEY",
    };
    expect(result.auth.apiKey).toBe("sk-test");
    expectTypeOf(result).toEqualTypeOf<AuthResult>();
  });
});
