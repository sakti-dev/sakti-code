import { useParams } from "@solidjs/router";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { cn } from "/@/lib/utils";
import type { DiffChange, FileTab, Message, Session, TerminalOutput } from "/@/types";

// Import workspace components
import Resizable from "@corvu/resizable";
import { ResizeableHandle } from "@renderer/components/resizeable-handle";
import { ChatPanel } from "./chat-area/chat-area";
import { LeftSide } from "./left-side/left-side";
import { ContextPanel } from "./right-side/right-side";

/**
 * WorkspaceView - Main 3-column AI-native workspace interface
 *
 * Architecture (Luminous Workspace Design):
 * - Left Panel (~20%): Session Manager
 * - Center (~50%): Agent Chat Interface
 * - Right (~30%): Context & Terminal split vertically
 */
export default function WorkspaceView() {
  const params = useParams();

  // State
  const [isLoading, setIsLoading] = createSignal(true);
  const [sessions, setSessions] = createSignal<Session[]>([
    {
      id: "session-1",
      title: "Initial setup and configuration",
      messages: [],
      projectId: params.id,
      lastUpdated: new Date(),
      status: "active",
    },
  ]);
  const [activeSessionId, setActiveSessionId] = createSignal<string>("session-1");
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [isGenerating, setIsGenerating] = createSignal(false);
  const [selectedModel, setSelectedModel] = createSignal<string>("claude-sonnet");
  const [panelSizes, setPanelSizes] = createSignal<number[]>([0.2, 0.5, 0.3]);
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

  const activeSession = () => sessions().find(s => s.id === activeSessionId());

  onMount(() => {
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

  const handleNewSession = () => {
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: "New conversation",
      messages: [],
      projectId: params.id,
      lastUpdated: new Date(),
      status: "active",
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMessages([]);
  };

  const handleSessionClick = (session: Session) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
  };

  const handleTogglePin = (session: Session) => {
    setSessions(prev => prev.map(s => (s.id === session.id ? { ...s, isPinned: !s.isPinned } : s)));
  };

  const handleSendMessage = (content: string) => {
    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, newMessage]);
    setIsGenerating(true);
    setTimeout(() => {
      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: "I understand. Let me help you with that...",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsGenerating(false);
    }, 1000);
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
  };

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

  return (
    <div class="bg-background h-screen flex-col overflow-hidden">
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
            sessions={sessions()}
            activeSessionId={activeSessionId()}
            onSessionClick={handleSessionClick}
            onNewSession={handleNewSession}
            onTogglePin={handleTogglePin}
          />

          {/* Resize Handle 1 */}
          <ResizeableHandle />

          {/* CENTER PANEL - Chat Interface */}
          <ChatPanel
            session={activeSession()}
            messages={messages()}
            isGenerating={isGenerating()}
            thinkingContent={""}
            onSend={handleSendMessage}
            onModelChange={handleModelChange}
            selectedModel={selectedModel()}
          />

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
