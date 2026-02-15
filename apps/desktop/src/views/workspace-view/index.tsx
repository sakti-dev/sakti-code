import type { DiffChange, FileTab, TerminalOutput } from "@/core/chat/types";
import { cn } from "@/utils";
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";

import { ResizeableHandle } from "@/components/ui/resizeable-handle";
import { useSessionTurns } from "@/core/chat/hooks";
import type { AgentMode } from "@/core/chat/types";
import { usePermissions } from "@/core/permissions/hooks/use-permissions";
import { useChatContext } from "@/state/contexts/chat-provider";
import {
  usePermissionStore,
  useProviderSelectionStore,
  useQuestionStore,
  useWorkspace,
  WorkspaceChatProvider,
  WorkspaceProvider,
} from "@/state/providers";
import Resizable from "@corvu/resizable";
import { ChatInput, type ChatInputModelOption, ChatPerfPanel, MessageTimeline } from "./chat-area";
import { LeftSide } from "./left-side/left-side";
import { ContextPanel } from "./right-side/right-side";

/**
 * WorkspaceViewContent - The actual content wrapped by provider
 */
function WorkspaceViewContent() {
  const DEBUG_PREFIX = "[model-selector-debug]";
  const ctx = useWorkspace();
  const providerSelection = useProviderSelectionStore();
  const { chat } = useChatContext();
  const permissions = usePermissions({
    client: ctx.client()!,
    workspace: () => ctx.workspace(),
    sessionId: ctx.activeSessionId,
  });
  const [permissionState] = usePermissionStore();
  const [questionState, questionActions] = useQuestionStore();

  // Panel sizes
  const [panelSizes, setPanelSizes] = createSignal<number[]>([0.2, 0.5, 0.3]);

  // Right panel state (still local for now)
  const [activeTopTab, setActiveTopTab] = createSignal<"files" | "diff">("files");
  const [openFiles, setOpenFiles] = createSignal<FileTab[]>([
    {
      id: "file-1",
      path: "/src/App.tsx",
      name: "App.tsx",
      isModified: false,
      isActive: true,
    },
  ]);
  const [diffChanges, setDiffChanges] = createSignal<DiffChange[]>([]);
  const [terminalOutput, setTerminalOutput] = createSignal<TerminalOutput[]>([
    {
      timestamp: new Date(),
      type: "info",
      content: "Workspace initialized",
    },
  ]);

  // Loading state
  const [isLoading, setIsLoading] = createSignal(true);
  const modelOptions = createMemo<ChatInputModelOption[]>(() =>
    providerSelection.docs().map(model => ({
      id: model.id,
      providerId: model.providerId,
      name: model.name,
      connected: model.connected,
    }))
  );
  const selectedModel = createMemo(
    () => providerSelection.data()?.preferences.selectedModelId ?? ""
  );
  createEffect(() => {
    console.log(`${DEBUG_PREFIX} workspace:selectedModel:changed`, {
      selectedModel: selectedModel(),
      selectedProviderId: providerSelection.data()?.preferences.selectedProviderId ?? null,
    });
  });
  const mapDocToOption = (model: {
    id: string;
    providerId: string;
    providerName?: string;
    name?: string;
    connected: boolean;
  }): ChatInputModelOption => ({
    id: model.id,
    providerId: model.providerId,
    providerName: model.providerName,
    name: model.name,
    connected: model.connected,
  });
  const connectedModelOptions = (query: string): ChatInputModelOption[] =>
    providerSelection.connectedResults(query).map(mapDocToOption);
  const notConnectedModelOptions = (query: string): ChatInputModelOption[] =>
    providerSelection.notConnectedResults(query).map(mapDocToOption);
  const modelSections = (query: string) =>
    providerSelection.providerGroupedSections(query).map(section => ({
      providerId: section.providerId,
      providerName: section.providerName,
      connected: section.connected,
      models: section.models.map(mapDocToOption),
    }));

  onMount(async () => {
    const storedSizes = localStorage.getItem("ekacode-panel-sizes");
    if (storedSizes) {
      try {
        setPanelSizes(JSON.parse(storedSizes));
      } catch (error) {
        console.error("Failed to parse panel sizes:", error);
      }
    }
    setIsLoading(false);
  });

  createEffect(() => {
    localStorage.setItem("ekacode-panel-sizes", JSON.stringify(panelSizes()));
  });

  // Ensure chat timeline has a concrete session context once sessions load.
  createEffect(() => {
    if (ctx.activeSessionId()) return;
    const firstSessionId = ctx.sessions()[0]?.sessionId;
    if (firstSessionId) {
      ctx.setActiveSessionId(firstSessionId);
    }
  });

  // Session handlers
  const handleNewSession = async () => {
    await ctx.createSession();
  };

  const handleSessionClick = (session: { sessionId?: string }) => {
    if (session.sessionId) {
      ctx.setActiveSessionId(session.sessionId);
    }
  };

  const handleTogglePin = () => {
    // TODO: Implement pin toggle with server
    console.log("Toggle pin not implemented yet");
  };

  // Chat handlers - use chat from ChatProvider
  const _handleSendMessage = async (content: string) => {
    await chat.sendMessage(content);
  };

  const _handleStop = () => {
    chat.stop();
  };

  const handleModelChange = (modelId: string) => {
    const selected = modelOptions().find(model => model.id === modelId);
    console.log(`${DEBUG_PREFIX} workspace:handleModelChange`, {
      modelId,
      found: Boolean(selected),
      currentSelectedModel: selectedModel(),
    });
    if (!selected) return;
    void providerSelection.setSelectedModel(selected.id).catch(error => {
      console.error("Failed to persist provider preferences:", error);
    });
  };

  const [draftMessage, setDraftMessage] = createSignal("");
  const [agentMode, setAgentMode] = createSignal<AgentMode>("plan");

  // File/diff handlers
  const handleTabClick = (tab: FileTab) => {
    setOpenFiles(prev =>
      prev.map(t => ({
        ...t,
        isActive: t.id === tab.id,
      }))
    );
  };

  const handleTabClose = (tab: FileTab) => {
    setOpenFiles(prev => {
      const filtered = prev.filter(t => t.id !== tab.id);
      if (tab.isActive && filtered.length > 0) {
        filtered[filtered.length - 1].isActive = true;
      }
      return filtered;
    });
  };

  const handleAcceptDiff = (change: DiffChange) => {
    setDiffChanges(prev =>
      prev.map(c => (c.id === change.id ? { ...c, status: "accepted" as const } : c))
    );
  };

  const handleRejectDiff = (change: DiffChange) => {
    setDiffChanges(prev =>
      prev.map(c => (c.id === change.id ? { ...c, status: "rejected" as const } : c))
    );
  };

  const handleAcceptAllDiffs = () => {
    setDiffChanges(prev =>
      prev.map(c => (c.status === "pending" ? { ...c, status: "accepted" as const } : c))
    );
  };

  const handleRejectAllDiffs = () => {
    setDiffChanges(prev =>
      prev.map(c => (c.status === "pending" ? { ...c, status: "rejected" as const } : c))
    );
  };

  const handleClearTerminal = () => {
    setTerminalOutput([]);
  };

  const isGenerating = () =>
    chat.streaming.status() === "connecting" || chat.streaming.status() === "streaming";
  const _chatError = () => chat.streaming.error();
  const effectiveSessionId = createMemo(() => chat.sessionId() ?? ctx.activeSessionId());
  const turns = useSessionTurns(effectiveSessionId);
  const _activeSession = () => {
    const id = effectiveSessionId();
    return ctx.sessions().find(s => s.sessionId === id);
  };

  const currentPendingPermission = createMemo(() => {
    const sessionId = effectiveSessionId();
    if (!sessionId) return undefined;

    const nextId = permissionState.pendingOrder.find(
      id => permissionState.byId[id]?.sessionID === sessionId
    );
    return nextId ? permissionState.byId[nextId] : undefined;
  });
  const currentPendingQuestion = createMemo(() => {
    const sessionId = effectiveSessionId();
    if (!sessionId) return undefined;

    const nextId = questionState.pendingOrder.find(
      id => questionState.byId[id]?.sessionID === sessionId
    );
    return nextId ? questionState.byId[nextId] : undefined;
  });

  const isPromptBlocked = createMemo(
    () => Boolean(currentPendingPermission()) || Boolean(currentPendingQuestion())
  );
  const pendingPermissionBanner = createMemo(() => {
    const pending = currentPendingPermission();
    if (!pending) return null;
    return {
      id: pending.id,
      toolName: pending.toolName,
      description: pending.description,
      patterns: pending.patterns,
    };
  });

  const handleApprovePermission = (id: string, patterns?: string[]) => {
    void permissions.approve(id, patterns);
  };
  const handleDenyPermission = (id: string) => {
    void permissions.deny(id);
  };
  const handleAnswerQuestion = (id: string, answer: unknown) => {
    questionActions.answer(id, answer);
  };
  const handleRejectQuestion = (id: string) => {
    questionActions.answer(id, { rejected: true });
  };

  const handleSubmitDraft = async () => {
    const content = draftMessage().trim();
    if (!content || isGenerating() || isPromptBlocked()) return;
    await _handleSendMessage(content);
    setDraftMessage("");
  };

  return (
    <div class="bg-background flex h-screen flex-col overflow-hidden">
      {/* Loading state */}
      <Show when={isLoading()}>
        <div class="flex h-full items-center justify-center">
          <div class={cn("flex flex-col items-center gap-4", "animate-fade-in-up")}>
            <div class="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl">
              <svg
                class="text-primary h-6 w-6 animate-pulse"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M6 14 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                />
              </svg>
            </div>
            <p class="text-muted-foreground text-sm">Loading workspace...</p>
          </div>
        </div>
      </Show>

      {/* Main workspace with corvu resizable layout */}
      <Show when={!isLoading()}>
        <Resizable
          sizes={panelSizes()}
          onSizesChange={setPanelSizes}
          class="flex h-full w-full overflow-hidden"
        >
          <LeftSide
            sessions={ctx.sessions()}
            activeSessionId={ctx.activeSessionId() ?? undefined}
            onSessionClick={handleSessionClick}
            onNewSession={handleNewSession}
            onTogglePin={handleTogglePin}
            isLoading={ctx.isLoadingSessions()}
          />

          {/* Resize Handle 1 */}
          <ResizeableHandle />

          {/* CENTER PANEL - Chat Interface */}
          <Resizable.Panel
            initialSize={0.5}
            minSize={0.2}
            class="bg-background relative flex h-full min-h-0 flex-1 flex-col"
          >
            <Show when={import.meta.env.DEV}>
              <ChatPerfPanel />
            </Show>
            {/* Messages - MessageTimeline handles its own scroll */}
            <MessageTimeline
              turns={turns}
              isStreaming={isGenerating}
              onPermissionApprove={handleApprovePermission}
              onPermissionDeny={handleDenyPermission}
              onQuestionAnswer={handleAnswerQuestion}
              onQuestionReject={handleRejectQuestion}
            />

            {/* Chat input - sibling to MessageTimeline */}
            <div class="border-border/30 shrink-0 border-x border-t p-4">
              <ChatInput
                value={draftMessage()}
                onValueChange={setDraftMessage}
                onSend={() => void handleSubmitDraft()}
                mode={agentMode()}
                onModeChange={setAgentMode}
                selectedModel={selectedModel()}
                modelOptions={modelOptions()}
                getModelSections={modelSections}
                getConnectedModelOptions={connectedModelOptions}
                getNotConnectedModelOptions={notConnectedModelOptions}
                onModelChange={handleModelChange}
                isSending={isGenerating()}
                disabled={isPromptBlocked()}
                pendingPermission={pendingPermissionBanner()}
                onPermissionApproveOnce={id => handleApprovePermission(id)}
                onPermissionApproveAlways={(id, patterns) => handleApprovePermission(id, patterns)}
                onPermissionDeny={handleDenyPermission}
                placeholder="Send a message..."
              />
            </div>
          </Resizable.Panel>

          {/* Resize Handle 2 */}
          <ResizeableHandle />

          {/* RIGHT PANEL - Context & Terminal */}
          <ContextPanel
            openFiles={openFiles()}
            diffChanges={diffChanges()}
            terminalOutput={terminalOutput()}
            activeTopTab={activeTopTab}
            onActiveTopTabChange={tab => setActiveTopTab(tab)}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onAcceptDiff={handleAcceptDiff}
            onRejectDiff={handleRejectDiff}
            onAcceptAllDiffs={handleAcceptAllDiffs}
            onRejectAllDiffs={handleRejectAllDiffs}
            onClearTerminal={handleClearTerminal}
          />
        </Resizable>
      </Show>
    </div>
  );
}

/**
 * WorkspaceView - Main 3-column AI-native workspace interface
 *
 * Architecture (Luminous Workspace Design):
 * - Left Panel (~20%): Session Manager
 * - Center (~50%): Agent Chat Interface
 * - Right (~30%): Context & Terminal split vertically
 *
 * Provider Nesting (NEW Architecture):
 * WorkspaceProvider → ChatProvider → WorkspaceViewContent
 *
 * ChatProvider uses the new presentation layer:
 * - useChat hook (from presentation/hooks/use-chat.ts)
 * - Domain stores via StoreProvider (in AppProvider)
 * - SSE events routed by AppProvider
 */
export default function WorkspaceView() {
  return (
    <WorkspaceProvider>
      <WorkspaceViewWithProviders />
    </WorkspaceProvider>
  );
}

/**
 * Inner component that has access to workspace context
 * Wraps ChatProvider with the new presentation layer
 */
function WorkspaceViewWithProviders() {
  const ctx = useWorkspace();
  const chatClient = createMemo(() => ctx.client());
  const hasWorkspace = createMemo(() => ctx.workspace().length > 0);
  const canRenderChat = createMemo(() => Boolean(chatClient()) && hasWorkspace());

  return (
    <Show when={canRenderChat()}>
      <WorkspaceChatProvider
        client={chatClient()!}
        workspace={() => ctx.workspace()}
        sessionId={ctx.activeSessionId}
        onSessionIdReceived={id => {
          if (id !== ctx.activeSessionId()) {
            ctx.setActiveSessionId(id);
            void ctx.refreshSessions();
          }
        }}
      >
        <WorkspaceViewContent />
      </WorkspaceChatProvider>
    </Show>
  );
}
