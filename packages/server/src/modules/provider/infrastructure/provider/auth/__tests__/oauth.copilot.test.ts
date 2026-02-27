import { describe, expect, it, vi } from "vitest";
import { completeOAuth, startOAuth } from "../../auth/oauth";
import type { ProviderAuthService } from "../../auth/service";

describe("github-copilot oauth", () => {
  it("authorizes and completes device oauth flow", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            verification_uri: "https://github.com/login/device",
            user_code: "WXYZ",
            device_code: "device-code-1",
            interval: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "copilot-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const authorize = await startOAuth({
      providerId: "github-copilot",
      method: 0,
    });

    expect(authorize.providerId).toBe("github-copilot");
    expect(authorize.method).toBe("auto");

    const authService: ProviderAuthService = {
      setToken: vi.fn(),
      setOAuth: vi.fn(),
      clear: vi.fn(),
      getState: vi.fn(),
      getCredential: vi.fn(),
    };

    const pending = await completeOAuth(
      {
        providerId: "github-copilot",
        method: 0,
        authorizationId: authorize.authorizationId,
      },
      authService
    );
    expect(pending.status).toBe("pending");

    const connected = await completeOAuth(
      {
        providerId: "github-copilot",
        method: 0,
        authorizationId: authorize.authorizationId,
      },
      authService
    );
    expect(connected.status).toBe("connected");
    expect(authService.setOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "github-copilot",
        accessToken: "copilot-access-token",
      })
    );

    fetchMock.mockRestore();
  });
});
