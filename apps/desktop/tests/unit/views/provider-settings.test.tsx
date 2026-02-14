import type { ProviderClient } from "@/core/services/api/provider-client";
import { ProviderSettings } from "@/views/components/provider-settings";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ProviderSettings", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("loads providers and connects token", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "token", label: "API Token" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([{ id: "zai/glm-4.7", providerId: "zai" }]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("Z.AI");

    const input = container.querySelector("input[type='password']") as HTMLInputElement;
    input.value = "token-123";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Connect"
    ) as HTMLButtonElement;
    connectButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.setToken).toHaveBeenCalledWith("zai", "token-123");
  });

  it("persists selected model preference", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "token", label: "API Token" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-4.7", providerId: "zai" },
        { id: "zai/glm-4.6v", providerId: "zai" },
      ]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    localStorage.removeItem("ekacode:selected-model");
    localStorage.removeItem("ekacode:selected-provider");

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const select = container.querySelector("select") as HTMLSelectElement;
    select.value = "zai/glm-4.6v";
    select.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(localStorage.getItem("ekacode:selected-model")).toBe("zai/glm-4.6v");
    expect(localStorage.getItem("ekacode:selected-provider")).toBe("zai");
  });

  it("runs oauth auto flow from provider settings", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "ekacodeAPI", {
      configurable: true,
      value: {
        shell: {
          openExternal,
        },
      },
    });

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "oauth", label: "Connect with Zen" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "oauth",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([{ id: "zai/glm-4.7", providerId: "zai" }]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn().mockResolvedValue({
        providerId: "zai",
        authorizationId: "oauth-1",
        url: "https://example.com/oauth",
        method: "auto",
        instructions: "Use browser",
      }),
      oauthCallback: vi.fn().mockResolvedValue({ status: "connected" }),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const connectOAuthButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect with Zen")
    ) as HTMLButtonElement;

    connectOAuthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.oauthAuthorize).toHaveBeenCalledWith("zai", 0);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");
    expect(client.oauthCallback).toHaveBeenCalledWith("zai", 0, "oauth-1");
  });

  it("shows oauth error when authorize fails", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "oauth", label: "Connect with Zen" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "oauth",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([{ id: "zai/glm-4.7", providerId: "zai" }]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn().mockRejectedValue(new Error("oauth failed")),
      oauthCallback: vi.fn().mockResolvedValue({ status: "pending" }),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const connectOAuthButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect with Zen")
    ) as HTMLButtonElement;

    connectOAuthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("oauth failed");
  });
});
