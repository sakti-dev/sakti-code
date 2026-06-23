import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProfileCache,
  resolveAuth,
  resolveModel,
} from "../model-resolver.ts";

const TEST_MODEL_ID = "gpt-4";

const PROFILE_NOT_FOUND_RE = /nonexistent/;
const MISSING_DEFAULT_RE = /models\.default/;
const NO_MODEL_CONFIGURED_RE = /no model configured/;
const PROJECT_NOT_FOUND_RE = /Project not found/;

function makeProfilesMock(
  profiles: unknown,
  mtimeMs: number
): { read: ReturnType<typeof vi.fn>; getMtimeMs: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(() => profiles),
    getMtimeMs: vi.fn(() => mtimeMs),
  };
}

function makeCtx(
  profilesMock: ReturnType<typeof makeProfilesMock>,
  project: { id: string; profileId: string | null } | null
) {
  return {
    profiles: profilesMock,
    repos: {
      projects: {
        findById: vi.fn((id: string) =>
          project && project.id === id ? project : null
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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: null,
      });

      const result = resolveModel(ctx, { projectId: "proj-1" });

      expect(result.provider).toBe("openai");
      expect(result.modelId).toBe(TEST_MODEL_ID);
      expect(result.thinkingLevel).toBe("medium");
      expect(result.model).toBeDefined();
    });

    it("resolves via project.profileId override", () => {
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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: "fast",
      });

      const result = resolveModel(ctx, { projectId: "proj-1" });

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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: null,
      });

      resolveModel(ctx, { projectId: "proj-1" });
      resolveModel(ctx, { projectId: "proj-1" });

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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: null,
      });

      resolveModel(ctx, { projectId: "proj-1" });
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

      const result = resolveModel(ctx, { projectId: "proj-1" });

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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: "nonexistent",
      });

      expect(() => resolveModel(ctx, { projectId: "proj-1" })).toThrow(
        PROFILE_NOT_FOUND_RE
      );
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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: null,
      });

      expect(() => resolveModel(ctx, { projectId: "proj-1" })).toThrow(
        MISSING_DEFAULT_RE
      );
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
        1000
      );
      const ctx = makeCtx(profilesMock, {
        id: "proj-1",
        profileId: null,
      });

      expect(() => resolveModel(ctx, { projectId: "proj-1" })).toThrow(
        NO_MODEL_CONFIGURED_RE
      );
    });

    it("throws when project is not found", () => {
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
        1000
      );
      const ctx = makeCtx(profilesMock, null);

      expect(() => resolveModel(ctx, { projectId: "missing" })).toThrow(
        PROJECT_NOT_FOUND_RE
      );
    });
  });

  describe("resolveAuth", () => {
    it("returns undefined when API key is not in env", () => {
      const savedKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
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
          1000
        );
        const ctx = makeCtx(profilesMock, {
          id: "proj-1",
          profileId: null,
        });

        const result = resolveAuth(ctx, { projectId: "proj-1" });
        expect(result).toBeUndefined();
      } finally {
        if (savedKey !== undefined) {
          process.env.OPENAI_API_KEY = savedKey;
        }
      }
    });

    it("returns ResolvedAuth when API key is in env", () => {
      const savedKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-test-key-1234567890";
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
          1000
        );
        const ctx = makeCtx(profilesMock, {
          id: "proj-1",
          profileId: null,
        });

        const result = resolveAuth(ctx, { projectId: "proj-1" });
        expect(result).toBeDefined();
        expect(result?.apiKey).toBe("sk-test-key-1234567890");
        expect(result?.provider).toBe("openai");
        expect(result?.thinkingLevel).toBe("off");
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
