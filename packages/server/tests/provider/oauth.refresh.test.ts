import { describe, expect, it, vi } from "vitest";
import { resolveOAuthAccessToken } from "../../src/provider/auth/oauth";
import type { ProviderAuthService } from "../../src/provider/auth/service";

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

    const token = await resolveOAuthAccessToken("zai", authService);
    expect(token).toBe("access-live");
    expect(authService.setOAuth).not.toHaveBeenCalled();
  });

  it("refreshes expired oauth credential and persists new tokens", async () => {
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

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 1200,
          account_label: "refreshed-user",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const token = await resolveOAuthAccessToken("zai", authService);

    expect(token).toBe("new-access");
    expect(authService.setOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "zai",
        accessToken: "new-access",
        refreshToken: "new-refresh",
      })
    );
    fetchMock.mockRestore();
  });
});
