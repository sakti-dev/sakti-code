import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chatProviderSpy = vi.hoisted(() => vi.fn());

vi.mock("@/core/state/contexts/chat-provider", () => ({
  ChatProvider: (props: {
    providerId?: () => string | undefined;
    modelId?: () => string | undefined;
    children: unknown;
  }) => {
    chatProviderSpy(props);
    return <>{props.children}</>;
  },
}));

vi.mock("@/core/state/providers/provider-selection-provider", () => ({
  ProviderSelectionProvider: (props: { children: unknown }) => <>{props.children}</>,
  useProviderSelectionStore: () => ({
    data: () => ({
      preferences: {
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
      },
    }),
  }),
}));

describe("WorkspaceChatProvider", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    chatProviderSpy.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it("injects selected provider/model accessors into ChatProvider", async () => {
    const { WorkspaceChatProvider } =
      await import("@/core/state/providers/workspace-chat-provider");

    const mockClient = {} as SaktiCodeApiClient;
    ({ unmount: dispose } = render(() => (
      <WorkspaceChatProvider
        client={mockClient}
        workspace={() => "/repo"}
        sessionId={() => "session-1"}
      >
        <div>child</div>
      </WorkspaceChatProvider>
    )));
    expect(chatProviderSpy).toHaveBeenCalledTimes(1);
    const call = chatProviderSpy.mock.calls[0]?.[0] as {
      providerId?: () => string | undefined;
      modelId?: () => string | undefined;
    };
    expect(call.providerId?.()).toBe("zai");
    expect(call.modelId?.()).toBe("zai/glm-4.7");
  });
});
