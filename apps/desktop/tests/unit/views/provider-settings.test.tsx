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

  it("shows empty-state when no provider connected", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("No provider connected yet.");
    expect(container.textContent).toContain("Select provider");
  });

  it("opens connect-provider modal and connects token", async () => {
    const listAuthStates = vi
      .fn()
      .mockResolvedValueOnce({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:01.000Z",
        },
      });

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
      listAuthStates,
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelector('[data-testid="provider-modal"]')).toBeTruthy();

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    input.value = "token-123";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const connect = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Connect"
    ) as HTMLButtonElement;
    connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(client.setToken).toHaveBeenCalledWith("zai", "token-123");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.textContent).not.toContain("No provider connected yet.");
    expect(container.textContent).toContain("Connected");
  });

  it("keeps provider connected in UI after successful token connect even if refetch is stale", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    input.value = "token-456";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const connect = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Connect"
    ) as HTMLButtonElement;
    connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.setToken).toHaveBeenCalledWith("zai", "token-456");
    expect(container.textContent).not.toContain("No provider connected yet.");
    expect(container.textContent).toContain("Connected");
  });

  it("treats api auth method as token input flow", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "openai", name: "OpenAI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ openai: [{ type: "api", label: "API Key" }] }),
      listAuthStates: vi.fn().mockResolvedValue({
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    input.value = "openai-key";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const connect = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Connect"
    ) as HTMLButtonElement;
    connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.setToken).toHaveBeenCalledWith("openai", "openai-key");
  });

  it("runs oauth auto flow from provider modal", async () => {
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
      listProviders: vi.fn().mockResolvedValue([{ id: "openai", name: "OpenAI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({
        openai: [{ type: "oauth", label: "ChatGPT Pro/Plus (browser)" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "oauth",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn().mockResolvedValue({
        providerId: "openai",
        authorizationId: "oauth-1",
        url: "https://example.com/oauth",
        method: "auto",
        instructions: "Use browser",
      }),
      oauthCallback: vi.fn().mockResolvedValue({ status: "connected" }),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const connectOAuthButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("ChatGPT Pro/Plus (browser)")
    ) as HTMLButtonElement;

    connectOAuthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.oauthAuthorize).toHaveBeenCalledWith("openai", 0);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");
    expect(client.oauthCallback).toHaveBeenCalledWith("openai", 0, "oauth-1");
  });

  it("shows oauth error when authorize fails", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "openai", name: "OpenAI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({
        openai: [{ type: "oauth", label: "ChatGPT Pro/Plus (browser)" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "oauth",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn().mockRejectedValue(new Error("oauth failed")),
      oauthCallback: vi.fn().mockResolvedValue({ status: "pending" }),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const connectOAuthButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("ChatGPT Pro/Plus (browser)")
    ) as HTMLButtonElement;

    connectOAuthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("oauth failed");
  });

  it("shows OpenCode Zen API key helper copy", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "opencode", name: "OpenCode Zen" }]),
      listProviderCatalog: vi.fn().mockResolvedValue([
        {
          id: "opencode",
          name: "OpenCode Zen",
          aliases: ["opencode", "zen"],
          authMethods: [{ type: "api", label: "API Key" }],
          connected: false,
          modelCount: 10,
          popular: true,
        },
      ]),
      listAuthMethods: vi.fn().mockResolvedValue({
        opencode: [{ type: "api", label: "API Key" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        opencode: {
          providerId: "opencode",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("Create an api key at https://opencode.ai/auth");
    expect(container.textContent).toContain("Search providers and connect with API key or OAuth");
    const apiInput = container.querySelector('input[placeholder="API key"]');
    expect(apiInput).toBeTruthy();
  });

  it("renders only API key input for api-only providers without oauth button", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "opencode", name: "OpenCode" },
        { id: "zai-coding-plan", name: "Z.AI Coding Plan" },
      ]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "api", label: "API Key" }],
        opencode: [{ type: "api", label: "API Key" }],
        "zai-coding-plan": [{ type: "api", label: "API Key" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
        opencode: {
          providerId: "opencode",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
        "zai-coding-plan": {
          providerId: "zai-coding-plan",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(b =>
      b.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const apiInput = container.querySelector('input[placeholder="API key"]');
    expect(apiInput).toBeTruthy();
    expect(container.textContent).toContain("Connect a provider");
    const oauthButtons = Array.from(container.querySelectorAll("button")).filter(b =>
      /oauth|Connect with/i.test(b.textContent || "")
    );

    expect(oauthButtons.length).toBe(0);
  });

  it("searches all providers inside connect dialog", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listProviderCatalog: vi.fn().mockResolvedValue([
        {
          id: "zai",
          name: "Z.AI",
          aliases: ["zai", "z.ai", "zen"],
          authMethods: [{ type: "oauth", label: "Connect with Zen" }],
          connected: false,
          modelCount: 12,
          popular: true,
        },
        {
          id: "zai-coding-plan",
          name: "Z.AI Coding Plan",
          aliases: ["zai-coding-plan", "coding plan", "zai plan"],
          authMethods: [{ type: "token", label: "API Token" }],
          connected: false,
          modelCount: 4,
          popular: true,
        },
        {
          id: "abacus",
          name: "Abacus",
          aliases: ["abacus"],
          authMethods: [{ type: "token", label: "API Token" }],
          connected: false,
          modelCount: 8,
          popular: false,
        },
      ]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "api", label: "API Key" }],
        "zai-coding-plan": [{ type: "token", label: "API Token" }],
        abacus: [{ type: "token", label: "API Token" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
        "zai-coding-plan": {
          providerId: "zai-coding-plan",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
        abacus: {
          providerId: "abacus",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn(),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).not.toContain("Connect with Zen");
    expect(container.querySelector('input[placeholder="API key"]')).toBeTruthy();
    expect(container.textContent).toContain("Abacus");

    const searchInput = container.querySelector(
      'input[placeholder="Search providers..."]'
    ) as HTMLInputElement;
    searchInput.value = "zai-coding-plan";
    searchInput.dispatchEvent(new InputEvent("input", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.textContent).toContain("Z.AI Coding Plan");
    expect(container.textContent).not.toContain("Abacus");
  });

  it("updates hybrid fallback preferences", async () => {
    const updatePreferences = vi.fn().mockResolvedValue({
      selectedProviderId: null,
      selectedModelId: null,
      hybridEnabled: false,
      hybridVisionProviderId: "zai",
      hybridVisionModelId: "zai/glm-4.6v",
      updatedAt: "2026-02-14T11:00:00.000Z",
    });
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
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
        {
          id: "zai/glm-4.6v",
          providerId: "zai",
          name: "GLM-4.6V",
          capabilities: { text: true, vision: true, tools: true, reasoning: true, plan: false },
        },
      ]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences,
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const hybridCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    hybridCheckbox.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(updatePreferences).toHaveBeenCalledWith({ hybridEnabled: false });
  });

  it("shows only connected vision-capable models in hybrid fallback selector", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthMethods: vi.fn().mockResolvedValue({
        zai: [{ type: "token", label: "API Token" }],
        openai: [{ type: "token", label: "API Token" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "zai/glm-4.6v",
          providerId: "zai",
          name: "GLM-4.6V",
          capabilities: { text: true, vision: true, tools: true, reasoning: true, plan: false },
        },
        {
          id: "openai/gpt-4o",
          providerId: "openai",
          name: "GPT-4o",
          capabilities: { text: true, vision: true, tools: true, reasoning: true, plan: false },
        },
      ]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const select = container.querySelector("select") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map(option => option.textContent);

    expect(options.some(label => label?.includes("GLM-4.6V"))).toBe(true);
    expect(options.some(label => label?.includes("GPT-4o"))).toBe(false);
  });

  it("disconnects from provider card and updates empty state", async () => {
    const listAuthStates = vi
      .fn()
      .mockResolvedValueOnce({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      })
      .mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:01.000Z",
        },
      });

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
      listAuthStates,
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("Connected");

    const disconnectButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Disconnect"
    ) as HTMLButtonElement;
    disconnectButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.clearToken).toHaveBeenCalledWith("zai");
    expect(container.textContent).toContain("No provider connected yet.");
  });

  it("shows connected section in modal and hides auth inputs when provider is connected", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain("This provider is connected.");
    expect(container.querySelector('input[placeholder="API key"]')).toBeNull();
    expect(container.textContent).toContain("Disconnect");
    expect(container.textContent).not.toContain("Connect with");
  });

  it("connects token for currently selected provider in modal", async () => {
    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "anthropic", name: "Anthropic" },
        { id: "opencode", name: "OpenCode Zen" },
      ]),
      listProviderCatalog: vi.fn().mockResolvedValue([
        {
          id: "anthropic",
          name: "Anthropic",
          aliases: ["anthropic"],
          authMethods: [{ type: "api", label: "API Key" }],
          connected: false,
          modelCount: 5,
          popular: true,
        },
        {
          id: "opencode",
          name: "OpenCode Zen",
          aliases: ["opencode", "zen"],
          authMethods: [{ type: "api", label: "API Key" }],
          connected: false,
          modelCount: 12,
          popular: true,
        },
      ]),
      listAuthMethods: vi.fn().mockResolvedValue({
        anthropic: [{ type: "api", label: "API Key" }],
        opencode: [{ type: "api", label: "API Key" }],
      }),
      listAuthStates: vi.fn().mockResolvedValue({
        anthropic: {
          providerId: "anthropic",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
        opencode: {
          providerId: "opencode",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      }),
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const openModalButton = Array.from(container.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Connect a provider")
    ) as HTMLButtonElement;
    openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = container.querySelector(
      '[data-testid="provider-option-opencode"]'
    ) as HTMLButtonElement;
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const input = container.querySelector('input[placeholder="API key"]') as HTMLInputElement;
    input.value = "opencode-key-123";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const connect = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Connect"
    ) as HTMLButtonElement;
    connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(client.setToken).toHaveBeenCalledWith("opencode", "opencode-key-123");
    expect(client.setToken).not.toHaveBeenCalledWith("anthropic", "opencode-key-123");
  });

  it("does not show loading fallback while disconnect refetch is in flight", async () => {
    const listAuthStates = vi
      .fn()
      .mockResolvedValueOnce({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T11:00:00.000Z",
        },
      })
      .mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve({
                  zai: {
                    providerId: "zai",
                    status: "connected",
                    method: "token",
                    accountLabel: null,
                    updatedAt: "2026-02-14T11:00:01.000Z",
                  },
                }),
              25
            )
          )
      );

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthMethods: vi.fn().mockResolvedValue({ zai: [{ type: "token", label: "API Token" }] }),
      listAuthStates,
      listModels: vi.fn().mockResolvedValue([]),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        hybridEnabled: true,
        hybridVisionProviderId: null,
        hybridVisionModelId: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
      updatePreferences: vi.fn(),
    };

    dispose = render(() => <ProviderSettings client={client} />, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const disconnectButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "Disconnect"
    ) as HTMLButtonElement;
    disconnectButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.textContent).not.toContain("Loading providers...");
  });
});
