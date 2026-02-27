import { describe, expect, it, vi } from "vitest";
import { resolveOAuthAccessToken } from "../../auth/oauth";
import type { ProviderAuthService } from "../../auth/service";

describe("oauth refresh", () => {
  it("returns existing access token when oauth credential is not expired", async () => {
    const authService: ProviderAuthService = {
      setToken: vi.fn(),
      setOAuth: vi.fn(),
      clear: vi.fn(),
      getState: vi.fn(),
      getCredential: vi.fn().mockResolvedValue({
        kind: "oauth",
        oauth: {
          accessToken: "access-live",
          refreshToken: "refresh-live",
          expiresAt: Date.now() + 60_000,
        },
      }),
    };

    const token = await resolveOAuthAccessToken("opencode", authService);
    expect(token).toBe("access-live");
    expect(authService.setOAuth).not.toHaveBeenCalled();
  });

  it("returns existing access token when provider has no oauth refresh implementation", async () => {
    const authService: ProviderAuthService = {
      setToken: vi.fn(),
      setOAuth: vi.fn(),
      clear: vi.fn(),
      getState: vi.fn(),
      getCredential: vi.fn().mockResolvedValue({
        kind: "oauth",
        oauth: {
          accessToken: "expired-access",
          refreshToken: "refresh-live",
          expiresAt: Date.now() - 1_000,
        },
      }),
    };

    const token = await resolveOAuthAccessToken("opencode", authService);

    expect(token).toBe("expired-access");
    expect(authService.setOAuth).not.toHaveBeenCalled();
  });
});
