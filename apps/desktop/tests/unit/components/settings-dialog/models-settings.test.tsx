import { ModelsSettings } from "@/components/settings-dialog/models-settings";
import type { ProviderClient } from "@/core/services/api/provider-client";
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("ModelsSettings", () => {
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

    const { unmount } = render(() => <ModelsSettings client={client} />);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.body.textContent).toContain("No provider connected yet.");
    expect(document.body.textContent).toContain("Select provider");

    unmount();
  });
});
