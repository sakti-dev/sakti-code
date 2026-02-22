import { cn } from "@/utils";
import { MessageSquare } from "lucide-solid";
import { createEffect, createSignal, onMount, Show } from "solid-js";

import { ResizeableHandle } from "@/components/ui/resizeable-handle";
import { useTasks } from "@/core/chat/hooks";
import { useWorkspace, WorkspaceChatProvider, WorkspaceProvider } from "@/state/providers";
import Resizable from "@corvu/resizable";
import { ChatArea } from "./chat-area/chat-area";
import { LeftSide } from "./left-side/left-side";
import { ContextPanel } from "./right-side/right-side";

function WorkspaceLayout() {
  const ctx = useWorkspace();
  const [panelSizes, setPanelSizes] = createSignal<number[]>([0.2, 0.5, 0.3]);
  const [isLoading, setIsLoading] = createSignal(true);

  const { startListening } = useTasks(ctx.activeSessionId);

  onMount(async () => {
    const storedSizes = localStorage.getItem("sakti-code-panel-sizes");
    if (storedSizes) {
      try {
        setPanelSizes(JSON.parse(storedSizes));
      } catch (error) {
        console.error("Failed to parse panel sizes:", error);
      }
    }
    startListening();
    setIsLoading(false);
  });

  createEffect(() => {
    localStorage.setItem("sakti-code-panel-sizes", JSON.stringify(panelSizes()));
  });

  createEffect(() => {
    if (ctx.activeSessionId()) return;
    const firstSessionId = ctx.sessions()[0]?.sessionId;
    if (firstSessionId) {
      ctx.setActiveSessionId(firstSessionId);
    }
  });

  return (
    <div class="bg-background flex h-screen flex-col overflow-hidden">
      <Show when={isLoading()}>
        <div class="flex h-full items-center justify-center">
          <div class={cn("flex flex-col items-center gap-4", "animate-fade-in-up")}>
            <div class="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl">
              <MessageSquare class="text-primary h-6 w-6 animate-pulse" />
            </div>
            <p class="text-muted-foreground text-sm">Loading workspace...</p>
          </div>
        </div>
      </Show>

      <Show when={!isLoading()}>
        <Resizable
          sizes={panelSizes()}
          onSizesChange={setPanelSizes}
          class="flex h-full w-full overflow-hidden"
        >
          <LeftSide />
          <ResizeableHandle />
          <ChatArea />
          <ResizeableHandle />
          <ContextPanel />
        </Resizable>
      </Show>
    </div>
  );
}

export default function WorkspaceView() {
  return (
    <WorkspaceProvider>
      <WorkspaceViewInner />
    </WorkspaceProvider>
  );
}

function WorkspaceViewInner() {
  const ctx = useWorkspace();
  const chatClient = () => ctx.client();
  const hasWorkspace = () => ctx.workspace().length > 0;
  const canRenderChat = () => Boolean(chatClient()) && hasWorkspace();

  return (
    <Show
      when={canRenderChat()}
      fallback={
        <div class="bg-background text-muted-foreground flex h-screen items-center justify-center">
          Loading workspace...
        </div>
      }
    >
      <WorkspaceChatProvider
        client={chatClient()!}
        workspace={ctx.workspace}
        sessionId={ctx.activeSessionId}
        onSessionIdReceived={id => {
          if (id !== ctx.activeSessionId()) {
            ctx.setActiveSessionId(id);
            void ctx.refreshSessions();
          }
        }}
      >
        <WorkspaceLayout />
      </WorkspaceChatProvider>
    </Show>
  );
}
