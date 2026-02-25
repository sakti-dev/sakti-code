import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { ChatProvider } from "@/core/state/contexts/chat-provider";
import { ProviderSelectionProvider, useProviderSelectionStore } from "@/core/state/providers";
import { createMemo, type Accessor, type JSX, type ParentComponent } from "solid-js";

interface WorkspaceChatProviderProps {
  client: SaktiCodeApiClient;
  workspace: Accessor<string>;
  sessionId: Accessor<string | null>;
  runtimeMode?: Accessor<"intake" | "plan" | "build" | undefined>;
  onSessionIdReceived?: (sessionId: string) => void;
  onError?: (error: Error) => void;
  onFinish?: (messageId: string) => void;
  children: JSX.Element;
}

function WorkspaceChatProviderInner(props: WorkspaceChatProviderProps) {
  const providerSelection = useProviderSelectionStore();
  const selectedProviderId = createMemo(
    () => providerSelection.data()?.preferences.selectedProviderId ?? undefined
  );
  const selectedModelId = createMemo(
    () => providerSelection.data()?.preferences.selectedModelId ?? undefined
  );

  return (
    <ChatProvider
      client={props.client}
      workspace={props.workspace}
      sessionId={props.sessionId}
      providerId={selectedProviderId}
      modelId={selectedModelId}
      runtimeMode={props.runtimeMode}
      onSessionIdReceived={props.onSessionIdReceived}
      onError={props.onError}
      onFinish={props.onFinish}
    >
      {props.children}
    </ChatProvider>
  );
}

export const WorkspaceChatProvider: ParentComponent<WorkspaceChatProviderProps> = props => {
  return (
    <ProviderSelectionProvider client={props.client.getProviderClient()}>
      <WorkspaceChatProviderInner {...props} />
    </ProviderSelectionProvider>
  );
};
