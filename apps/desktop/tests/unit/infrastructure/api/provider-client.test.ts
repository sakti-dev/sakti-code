import { createProviderClient } from "@/core/services/api/provider-client";
import { describe, expect, it, vi } from "vitest";

describe("provider client", () => {
  it("lists providers", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ providers: [{ id: "zai", name: "Z.AI" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const client = createProviderClient({
      fetcher,
    });

    const providers = await client.listProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("zai");
    expect(fetcher).toHaveBeenCalledWith("/api/providers", { method: "GET" });
  });

  it("lists models", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ id: "zai/glm-4.7", providerId: "zai" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const client = createProviderClient({ fetcher });
    const models = await client.listModels();

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("zai/glm-4.7");
    expect(fetcher).toHaveBeenCalledWith("/api/providers/models", { method: "GET" });
  });

  it("sets and clears provider token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const client = createProviderClient({ fetcher });

    await client.setToken("zai", "token-123");
    await client.clearToken("zai");

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/providers/zai/auth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      })
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/providers/zai/auth/token",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("lists auth methods and performs oauth authorize/callback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            zai: [
              { type: "token", label: "API Token" },
              { type: "oauth", label: "Login with Zen" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            providerId: "zai",
            authorizationId: "auth-1",
            url: "https://example.com/oauth",
            method: "auto",
            instructions: "Continue in browser",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "connected" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const client = createProviderClient({ fetcher });

    const methods = await client.listAuthMethods();
    expect(methods.zai).toHaveLength(2);

    const auth = await client.oauthAuthorize("zai", 1);
    expect(auth.authorizationId).toBe("auth-1");

    const callback = await client.oauthCallback("zai", 1, "auth-1");
    expect(callback.status).toBe("connected");
  });
});
