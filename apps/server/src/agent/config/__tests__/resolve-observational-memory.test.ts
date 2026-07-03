import { describe, expect, it, vi } from "vite-plus/test";
import { TokenCounter } from "@sakti-code/agent";
import { resolveOmConfig } from "../resolve-observational-memory.ts";

function makeCtx(
  profiles: unknown,
  settings: unknown,
  auth?: { getApiKey: (provider: string) => string | undefined },
) {
  return {
    auth: auth ?? { getApiKey: () => undefined },
    profiles: {
      read: vi.fn(() => profiles),
      getMtimeMs: vi.fn(() => 0),
    },
    settingsFile: {
      read: vi.fn(() => settings),
    },
    log: {
      agent: {
        warn: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
      },
    },
  } as any;
}

const PROFILES = {
  defaultProfile: "default",
  profiles: {
    default: {
      name: "Default",
      models: {
        default: { provider: "openai", model: "gpt-4" },
      },
    },
    withOm: {
      name: "With OM",
      models: {
        default: { provider: "openai", model: "gpt-4" },
        observe: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
        reflect: { provider: "openai", model: "o3" },
      },
    },
  },
};

const SESSION = { id: "sess-1", kind: "mission", projectId: "proj-1", profileId: null };

describe("resolveOmConfig", () => {
  it("returns undefined when OM is explicitly disabled", () => {
    const ctx = makeCtx(PROFILES, { observationalMemory: { enabled: false } });
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeUndefined();
  });

  it("returns config when OM key is absent (default enabled)", () => {
    const ctx = makeCtx(PROFILES, { other: "value" }, { getApiKey: () => "sk-test" });
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeDefined();
  });

  it("returns undefined when enabled is false", () => {
    const ctx = makeCtx(PROFILES, { observationalMemory: { enabled: false } });
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeUndefined();
  });

  it("returns undefined when API key is missing for observe provider", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: (p) => (p === "openai" ? undefined : "sk-test"),
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeUndefined();
  });

  it("returns undefined when API key is missing for reflect provider", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: (p) => (p === "openai" ? undefined : "sk-test"),
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeUndefined();
  });

  it("returns config with default thresholds when enabled", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeDefined();
    expect(result!.thresholds.observation).toBe(30_000);
    expect(result!.thresholds.reflection).toBe(40_000);
  });

  it("uses custom thresholds from settings", () => {
    const ctx = makeCtx(
      PROFILES,
      {
        observationalMemory: {
          enabled: true,
          observationThreshold: 50_000,
          reflectionThreshold: 60_000,
        },
      },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeDefined();
    expect(result!.thresholds.observation).toBe(50_000);
    expect(result!.thresholds.reflection).toBe(60_000);
  });

  it("resolves observe/reflect from explicit profile entry", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, { ...SESSION, profileId: "withOm" });
    expect(result).toBeDefined();
    expect(result!.observeModel.id).toBe("claude-haiku-4-5-20251001");
    expect(result!.reflectModel.id).toBe("o3");
  });

  it("resolves observe/reflect to default when absent from profile", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeDefined();
    expect(result!.observeModel.id).toBe("gpt-4");
    expect(result!.reflectModel.id).toBe("gpt-4");
  });

  it("returns undefined when profile is missing", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, { ...SESSION, profileId: "nonexistent" });
    expect(result).toBeUndefined();
  });

  it("passes instruction through from settings", () => {
    const ctx = makeCtx(
      PROFILES,
      {
        observationalMemory: { enabled: true, instruction: "Be concise." },
      },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeDefined();
    expect(result!.instruction).toBe("Be concise.");
  });

  it("omits instruction when not set in settings", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: () => "sk-test",
      },
    );
    const result = resolveOmConfig(ctx, SESSION);
    expect(result).toBeDefined();
    expect(result!.instruction).toBeUndefined();
  });

  it("tokenCounter is constructed fresh per call, scoped to the observe model (M5)", () => {
    const ctx = makeCtx(
      PROFILES,
      { observationalMemory: { enabled: true } },
      {
        getApiKey: () => "sk-test",
      },
    );
    const a = resolveOmConfig(ctx, SESSION);
    const b = resolveOmConfig(ctx, SESSION);
    expect(a!.tokenCounter).toBeInstanceOf(TokenCounter);
    // Per-run, not cached — two resolves yield distinct instances so the
    // model context always matches the current observe model.
    expect(a!.tokenCounter).not.toBe(b!.tokenCounter);
  });
});
