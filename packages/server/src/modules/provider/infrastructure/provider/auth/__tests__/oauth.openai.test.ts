import { describe, expect, it, vi } from "vitest";
import { completeOAuth, resolveOAuthAccessToken, startOAuth } from "../../auth/oauth";
import { __openAIOAuthTest } from "../../auth/providers/openai";
import type { ProviderAuthService } from "../../auth/service";

describe("openai oauth", () => {
  it("rejects oauth authorize for api-only providers", async () => {
    await expect(startOAuth({ providerId: "zai", method: 0 })).rejects.toThrow(
      /Invalid oauth method/
    );
    await expect(startOAuth({ providerId: "opencode", method: 0 })).rejects.toThrow(
      /Invalid oauth method/
    );
    await expect(startOAuth({ providerId: "zai-coding-plan", method: 0 })).rejects.toThrow(
      /Invalid oauth method/
    );
  });

  it("authorizes and completes browser oauth code flow", async () => {
    __openAIOAuthTest.resetBrowserOAuthStateForTest();
    process.env.SAKTI_CODE_OPENAI_OAUTH_DISABLE_LOCAL_SERVER = "1";
    process.env.SAKTI_CODE_OPENAI_OAUTH_CALLBACK_PORT = "16555";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access-browser-1",
          refresh_token: "refresh-browser-1",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const authorize = await startOAuth({
      providerId: "openai",
      method: 0,
    });

    expect(authorize.providerId).toBe("openai");
    expect(authorize.method).toBe("auto");
    expect(authorize.url).toContain("auth.openai.com/oauth/authorize");

    const authService: ProviderAuthService = {
      setToken: vi.fn(),
      setOAuth: vi.fn(),
      clear: vi.fn(),
      getState: vi.fn(),
      getCredential: vi.fn(),
    };

    const pending = await completeOAuth(
      {
        providerId: "openai",
        method: 0,
        authorizationId: authorize.authorizationId,
      },
      authService
    );
    expect(pending.status).toBe("pending");

    const callbackURL = new URL(authorize.url);
    const state = callbackURL.searchParams.get("state");
    expect(typeof state).toBe("string");
    __openAIOAuthTest.setBrowserOAuthStateForTest(state!, { code: "browser-code-1" });

    const connected = await completeOAuth(
      {
        providerId: "openai",
        method: 0,
        authorizationId: authorize.authorizationId,
      },
      authService
    );
    expect(connected.status).toBe("connected");
    expect(authService.setOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        accessToken: "access-browser-1",
        refreshToken: "refresh-browser-1",
      })
    );

    fetchMock.mockRestore();
    delete process.env.SAKTI_CODE_OPENAI_OAUTH_DISABLE_LOCAL_SERVER;
    delete process.env.SAKTI_CODE_OPENAI_OAUTH_CALLBACK_PORT;
  });

  it("authorizes and completes headless oauth flow", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_auth_id: "device-auth-1",
            user_code: "ABCD",
            interval: "1",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_code: "auth-code-1",
            code_verifier: "code-verifier-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const authorize = await startOAuth({
      providerId: "openai",
      method: 1,
    });

    expect(authorize.providerId).toBe("openai");
    expect(authorize.method).toBe("auto");
    expect(authorize.url).toContain("auth.openai.com");

    const authService: ProviderAuthService = {
      setToken: vi.fn(),
      setOAuth: vi.fn(),
      clear: vi.fn(),
      getState: vi.fn(),
      getCredential: vi.fn(),
    };

    const pending = await completeOAuth(
      {
        providerId: "openai",
        method: 1,
        authorizationId: authorize.authorizationId,
      },
      authService
    );
    expect(pending.status).toBe("pending");

    const connected = await completeOAuth(
      {
        providerId: "openai",
        method: 1,
        authorizationId: authorize.authorizationId,
      },
      authService
    );
    expect(connected.status).toBe("connected");
    expect(authService.setOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        accessToken: "access-1",
        refreshToken: "refresh-1",
      })
    );

    fetchMock.mockRestore();
  });

  it("refreshes expired openai oauth token", async () => {
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
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const token = await resolveOAuthAccessToken("openai", authService);

    expect(token).toBe("new-access");
    expect(authService.setOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        accessToken: "new-access",
        refreshToken: "new-refresh",
      })
    );
    fetchMock.mockRestore();
  });
});
