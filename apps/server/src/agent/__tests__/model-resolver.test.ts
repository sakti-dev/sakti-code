import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearProfileCache, resolveAuth, resolveModel } from "../model-resolver.ts";
import { resolveThinkingLevel } from "../runner.ts";

const TEST_MODEL_ID = "gpt-4";

const PROFILE_NOT_FOUND_RE = /nonexistent/;
const MISSING_DEFAULT_RE = /models\.default/;
const NO_MODEL_CONFIGURED_RE = /no model configured/;

function makeProfilesMock(
  profiles: unknown,
  mtimeMs: number,
): { read: ReturnType<typeof vi.fn>; getMtimeMs: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(() => profiles),
    getMtimeMs: vi.fn(() => mtimeMs),
  };
}

function makeCtx(
  profilesMock: ReturnType<typeof makeProfilesMock>,
  session: {
    kind?: string;
    projectId: string;
    profileId: string | null;
  } | null,
  auth?: { getApiKey: (provider: string) => string | undefined },
) {
  return {
    auth: auth ?? { getApiKey: () => undefined },
    profiles: profilesMock,
    repos: {
      projects: {
        findById: vi.fn((id: string) =>
          session && session.projectId === id
            ? { id, name: "test", cwd: "/tmp", createdAt: 0, updatedAt: 0 }
            : null,
        ),
      },
      sessions: {
        findById: vi.fn(() =>
          session
            ? {
                id: "sess-1",
                projectId: session.projectId,
                profileId: session.profileId,
                modelId: null,
                title: null,
                thinkingLevel: "off",
                kind: "task",
                createdAt: 0,
                updatedAt: 0,
              }
            : null,
        ),
      },
    },
  } as any;
}

describe("resolveModel / resolveAuth", () => {
  beforeEach(() => {
    clearProfileCache();
  });

  describe("resolveModel", () => {
    it("resolves model from default profile", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: {
                  provider: "openai",
                  model: TEST_MODEL_ID,
                  thinkingLevel: "medium",
                },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      const result = resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      expect(result.provider).toBe("openai");
      expect(result.modelId).toBe(TEST_MODEL_ID);
      expect(result.thinkingLevel).toBe("medium");
      expect(result.model).toBeDefined();
    });

    it("resolves via session.profileId override", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "balanced",
          profiles: {
            balanced: {
              name: "Balanced",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
            fast: {
              name: "Fast",
              models: {
                default: { provider: "groq", model: "llama-3.1-8b-instant" },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: "fast",
        kind: "task",
      });

      const result = resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: "fast",
        kind: "task",
      });

      expect(result.provider).toBe("groq");
      expect(result.modelId).toBe("llama-3.1-8b-instant");
    });

    it("caches profiles when mtime is unchanged", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });
      resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      expect(profilesMock.read).toHaveBeenCalledTimes(1);
    });

    it("re-reads profiles when mtime changes", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });
      expect(profilesMock.read).toHaveBeenCalledTimes(1);

      // Simulate external edit to profiles.json
      profilesMock.getMtimeMs.mockReturnValue(2000);
      profilesMock.read.mockReturnValue({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "anthropic",
                model: "claude-sonnet-4-20250514",
              },
            },
          },
        },
      });

      const result = resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      expect(profilesMock.read).toHaveBeenCalledTimes(2);
      expect(result.provider).toBe("anthropic");
    });

    it("throws when profile is not found", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: "nonexistent",
        kind: "task",
      });

      expect(() =>
        resolveModel(ctx, {
          id: "sess-1",
          projectId: "proj-1",
          profileId: "nonexistent",
          kind: "task",
        }),
      ).toThrow(PROFILE_NOT_FOUND_RE);
    });

    it("throws when profile has no models.default", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "bad",
          profiles: {
            bad: {
              name: "Bad",
              models: {},
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      expect(() =>
        resolveModel(ctx, {
          id: "sess-1",
          projectId: "proj-1",
          profileId: null,
          kind: "task",
        }),
      ).toThrow(MISSING_DEFAULT_RE);
    });

    it("throws on empty provider/model with clear message", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "", model: "" },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      expect(() =>
        resolveModel(ctx, {
          id: "sess-1",
          projectId: "proj-1",
          profileId: null,
          kind: "task",
        }),
      ).toThrow(NO_MODEL_CONFIGURED_RE);
    });

    it("resolves intake model when session kind is intake", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
                intake: {
                  provider: "anthropic",
                  model: "claude-sonnet-4-20250514",
                },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
      });

      const result = resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "intake",
      });

      expect(result.provider).toBe("anthropic");
      expect(result.modelId).toBe("claude-sonnet-4-20250514");
    });

    it("falls back to default when intake mode has no model configured", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
      });

      const result = resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "intake",
      });

      expect(result.provider).toBe("openai");
      expect(result.modelId).toBe(TEST_MODEL_ID);
    });

    it("uses default mode for task kind even when intake is configured", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
                intake: {
                  provider: "anthropic",
                  model: "claude-sonnet-4-20250514",
                },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
      });

      const result = resolveModel(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      expect(result.provider).toBe("openai");
      expect(result.modelId).toBe(TEST_MODEL_ID);
    });
  });

  describe("resolveAuth", () => {
    it("returns undefined when no key is stored for the provider", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });

      const result = resolveAuth(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });
      expect(result).toBeUndefined();
    });

    it("returns ResolvedAuth when auth store has the key", () => {
      const profilesMock = makeProfilesMock(
        {
          defaultProfile: "default",
          profiles: {
            default: {
              name: "Default",
              models: {
                default: { provider: "openai", model: TEST_MODEL_ID },
              },
            },
          },
        },
        1000,
      );
      const ctx = makeCtx(
        profilesMock,
        { projectId: "proj-1", profileId: null },
        {
          getApiKey: (provider) => (provider === "openai" ? "sk-test-key-1234567890" : undefined),
        },
      );

      const result = resolveAuth(ctx, {
        id: "sess-1",
        projectId: "proj-1",
        profileId: null,
        kind: "task",
      });
      expect(result).toBeDefined();
      expect(result?.apiKey).toBe("sk-test-key-1234567890");
      expect(result?.provider).toBe("openai");
      expect(result?.thinkingLevel).toBe("off");
    });

    it("ignores env vars — only auth.json is consulted", () => {
      const savedKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-from-env-1234567890";
      try {
        const profilesMock = makeProfilesMock(
          {
            defaultProfile: "default",
            profiles: {
              default: {
                name: "Default",
                models: {
                  default: { provider: "openai", model: TEST_MODEL_ID },
                },
              },
            },
          },
          1000,
        );
        // auth store has no key for openai → resolveAuth returns undefined
        // even though process.env.OPENAI_API_KEY is set
        const ctx = makeCtx(profilesMock, {
          projectId: "proj-1",
          profileId: null,
        });

        const result = resolveAuth(ctx, {
          id: "sess-1",
          projectId: "proj-1",
          profileId: null,
          kind: "task",
        });
        expect(result).toBeUndefined();
      } finally {
        if (savedKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = savedKey;
        }
      }
    });
  });
});

describe("resolveThinkingLevel with profile fallback", () => {
  function makeSettingsCtx(getValue: string | null) {
    return {
      repos: {
        settings: {
          get: vi.fn(() => getValue),
        },
      },
    } as unknown as Parameters<typeof resolveThinkingLevel>[0];
  }

  it("uses profile thinkingLevel when no session-level override exists", () => {
    const ctx = makeSettingsCtx(null);

    const result = resolveThinkingLevel(
      ctx,
      "sess-1",
      {
        thinkingLevel: "off",
      },
      "high",
    );

    expect(result).toBe("high");
  });

  it("per-session setting overrides profile thinkingLevel", () => {
    const ctx = makeSettingsCtx("low");

    const result = resolveThinkingLevel(
      ctx,
      "sess-1",
      {
        thinkingLevel: "off",
      },
      "high",
    );

    expect(result).toBe("low");
  });

  it("session row thinkingLevel overrides profile when not 'off'", () => {
    const ctx = makeSettingsCtx(null);

    const result = resolveThinkingLevel(
      ctx,
      "sess-1",
      {
        thinkingLevel: "medium",
      },
      "high",
    );

    expect(result).toBe("medium");
  });

  it("defaults to 'off' when profile is also 'off'", () => {
    const ctx = makeSettingsCtx(null);

    const result = resolveThinkingLevel(
      ctx,
      "sess-1",
      {
        thinkingLevel: "off",
      },
      "off",
    );

    expect(result).toBe("off");
  });
});
