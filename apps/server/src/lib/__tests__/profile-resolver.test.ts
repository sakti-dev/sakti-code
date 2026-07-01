import { describe, expect, it } from "vite-plus/test";
import { resolveModelRef } from "../profile-resolver.ts";
import type { Profiles } from "../profiles-store.ts";

const MISSING_PROFILE_RE = /nonexistent/;
const MISSING_DEFAULT_RE = /default/;
const NO_MODEL_CONFIGURED_RE = /no model configured/;

const PROFILES: Profiles = {
  defaultProfile: "balanced",
  profiles: {
    balanced: {
      name: "Balanced",
      models: {
        default: {
          provider: "anthropic",
          model: "claude-sonnet",
          thinkingLevel: "medium",
        },
        plan: {
          provider: "openai",
          model: "gpt-4o",
        },
      },
    },
    fast: {
      name: "Fast",
      models: {
        default: { provider: "groq", model: "llama-fast" },
      },
    },
  },
};

describe("resolveModelRef", () => {
  it("resolves via defaultProfile when profileId is null", () => {
    const ref = resolveModelRef(PROFILES, null, "default");
    expect(ref.provider).toBe("anthropic");
    expect(ref.model).toBe("claude-sonnet");
    expect(ref.thinkingLevel).toBe("medium");
  });

  it("resolves via explicit profileId", () => {
    const ref = resolveModelRef(PROFILES, "fast", "default");
    expect(ref.provider).toBe("groq");
    expect(ref.model).toBe("llama-fast");
  });

  it("falls back to default model when mode entry is absent", () => {
    const ref = resolveModelRef(PROFILES, "fast", "plan");
    expect(ref.provider).toBe("groq");
    expect(ref.model).toBe("llama-fast");
  });

  it("resolves observe to default when absent from profile", () => {
    const ref = resolveModelRef(PROFILES, null, "observe");
    expect(ref.provider).toBe("anthropic");
    expect(ref.model).toBe("claude-sonnet");
  });

  it("resolves reflect to default when absent from profile", () => {
    const ref = resolveModelRef(PROFILES, null, "reflect");
    expect(ref.provider).toBe("anthropic");
    expect(ref.model).toBe("claude-sonnet");
  });

  it("resolves observe to explicit entry when present", () => {
    const withObserve: Profiles = {
      defaultProfile: "default",
      profiles: {
        default: {
          name: "Default",
          models: {
            default: { provider: "anthropic", model: "claude-sonnet" },
            observe: { provider: "groq", model: "llama-fast" },
          },
        },
      },
    };
    const ref = resolveModelRef(withObserve, "default", "observe");
    expect(ref.provider).toBe("groq");
    expect(ref.model).toBe("llama-fast");
  });

  it("resolves reflect to explicit entry when present", () => {
    const withReflect: Profiles = {
      defaultProfile: "default",
      profiles: {
        default: {
          name: "Default",
          models: {
            default: { provider: "anthropic", model: "claude-sonnet" },
            reflect: { provider: "openai", model: "gpt-4o", thinkingLevel: "high" },
          },
        },
      },
    };
    const ref = resolveModelRef(withReflect, "default", "reflect");
    expect(ref.provider).toBe("openai");
    expect(ref.model).toBe("gpt-4o");
    expect(ref.thinkingLevel).toBe("high");
  });

  it("uses mode override when available", () => {
    const ref = resolveModelRef(PROFILES, "balanced", "plan");
    expect(ref.provider).toBe("openai");
    expect(ref.model).toBe("gpt-4o");
    expect(ref.thinkingLevel).toBe("off");
  });

  it("throws on missing profile", () => {
    expect(() => resolveModelRef(PROFILES, "nonexistent", "default")).toThrow(MISSING_PROFILE_RE);
  });

  it("throws on missing default model", () => {
    const broken: Profiles = {
      defaultProfile: "bad",
      profiles: {
        bad: {
          name: "Bad",
          models: {} as Profiles["profiles"]["bad"]["models"],
        },
      },
    };
    expect(() => resolveModelRef(broken, null, "default")).toThrow(MISSING_DEFAULT_RE);
  });

  it("throws on empty provider/model with a clear message", () => {
    const unconfigured: Profiles = {
      defaultProfile: "default",
      profiles: {
        default: {
          name: "Default",
          models: {
            default: { provider: "", model: "" },
          },
        },
      },
    };
    expect(() => resolveModelRef(unconfigured, null, "default")).toThrow(NO_MODEL_CONFIGURED_RE);
  });

  it("thinkingLevel defaults to 'off' when not specified", () => {
    const ref = resolveModelRef(PROFILES, "balanced", "plan");
    expect(ref.thinkingLevel).toBe("off");
  });
});
