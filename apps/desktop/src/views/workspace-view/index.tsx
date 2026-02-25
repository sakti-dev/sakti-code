import { cn } from "@/utils";
import { MessageSquare } from "lucide-solid";
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { transitionSessionMode } from "@sakti-code/core/session/mode-transition";

import { HomepageView } from "@/views/homepage-view/homepage-view";
import { TopToolbar } from "@/components/top-toolbar/top-toolbar";
import { ResizeableHandle } from "@/components/ui/resizeable-handle";
import { useTasks } from "@/core/chat/hooks";
import { initializeWizardWorkflowFromHomepage } from "@/core/chat/services/spec-wizard-controller";
import { parseChatStream } from "@/core/chat/services/chat-stream-parser";
import { useWorkspace, WorkspaceChatProvider, WorkspaceProvider } from "@/state/providers";
import Resizable from "@corvu/resizable";
import { ChatArea } from "./chat-area/chat-area";
import { LeftSide } from "./left-side/left-side";
import { ContextPanel } from "./right-side/right-side";
import type { WelcomeKeypoint } from "@/components/welcome-panel/welcome-panel";

function WorkspaceLayout() {
  const ctx = useWorkspace();
  const [panelSizes, setPanelSizes] = createSignal<number[]>([0.2, 0.5, 0.3]);
  const [isLoading, setIsLoading] = createSignal(true);

  const { startListening } = useTasks(ctx.activeTaskSessionId);

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
  const canRenderWorkspace = () => Boolean(chatClient()) && hasWorkspace();
  const isHomepageMode = createMemo(() => ctx.activeTaskSessionId() === null);
  const currentTaskTitle = createMemo(() => {
    const currentId = ctx.activeTaskSessionId();
    if (!currentId) return "Task session";
    const current = ctx.taskSessions().find(task => task.taskSessionId === currentId);
    return current?.title ?? "Task session";
  });
  const activeTaskRuntimeMode = createMemo<"plan" | "build" | undefined>(() => {
    const activeId = ctx.activeTaskSessionId();
    if (!activeId) return undefined;
    const activeTask = ctx.taskSessions().find(task => task.taskSessionId === activeId);
    if (!activeTask) return "plan";
    if (activeTask.runtimeMode === "plan" || activeTask.runtimeMode === "build") {
      return activeTask.runtimeMode;
    }
    if (activeTask.taskStatus === "implementing" || activeTask.taskStatus === "completed") {
      return "build";
    }
    return "plan";
  });
  const homepageTasks = createMemo(() =>
    ctx.taskSessions().map(task => ({
      taskSessionId: task.taskSessionId,
      title: task.title,
      status: task.taskStatus,
      specType: task.specType,
      lastActivityAt: task.lastActivityAt,
    }))
  );
  const [intakeTaskSessionId, setIntakeTaskSessionId] = createSignal<string | null>(null);
  const [researchSummary, setResearchSummary] = createSignal("");
  const [researchLoading, setResearchLoading] = createSignal(false);
  const [researchError, setResearchError] = createSignal<string | null>(null);
  const [isApplyingResearchAction, setIsApplyingResearchAction] = createSignal(false);
  const [keypoints, setKeypoints] = createSignal<WelcomeKeypoint[]>([]);

  const validateHandoff = (
    value: unknown
  ):
    | {
        title: string;
        specType: "comprehensive" | "quick";
        initialSummary: string;
        handoffContext: string;
      }
    | null => {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.title !== "string" || !candidate.title.trim()) return null;
    if (candidate.specType !== "comprehensive" && candidate.specType !== "quick") return null;
    if (typeof candidate.initialSummary !== "string" || !candidate.initialSummary.trim()) return null;
    if (typeof candidate.handoffContext !== "string" || !candidate.handoffContext.trim()) return null;
    return {
      title: candidate.title,
      specType: candidate.specType,
      initialSummary: candidate.initialSummary,
      handoffContext: candidate.handoffContext,
    };
  };

  const loadKeypoints = async () => {
    const client = chatClient();
    if (!client) return;
    try {
      const data = await client.listProjectKeypoints(ctx.projectId());
      setKeypoints(
        data.map(keypoint => ({
          id: keypoint.id,
          taskTitle: keypoint.taskTitle,
          milestone: keypoint.milestone,
          completedAt: keypoint.completedAt,
          summary: keypoint.summary,
        }))
      );
    } catch (error) {
      console.error("Failed to load keypoints:", error);
    }
  };

  createEffect(() => {
    if (!canRenderWorkspace()) return;
    void loadKeypoints();
  });

  const ensureIntakeTaskSessionId = async (): Promise<string> => {
    const existing = intakeTaskSessionId();
    if (existing) return existing;
    const client = chatClient();
    if (!client) throw new Error("API client not available");
    const created = await client.createTaskSession({
      resourceId: ctx.workspace() || ctx.projectId(),
      workspaceId: ctx.projectId(),
      sessionKind: "intake",
    });
    setIntakeTaskSessionId(created.taskSessionId);
    return created.taskSessionId;
  };

  const readAssistantTextFromResponse = async (response: Response): Promise<string> => {
    const reader = response.body?.getReader();
    if (!reader) return "";

    let text = "";
    await parseChatStream(reader, {
      onTextDelta: (_messageId, delta) => {
        text += delta;
      },
    });
    return text.trim();
  };

  const extractJsonObject = (raw: string): Record<string, unknown> | null => {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    const candidate = fenced?.[1] ?? raw;
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const handleSubmitResearch = async (message: string) => {
    const client = chatClient();
    if (!client) return;

    setResearchError(null);
    setResearchLoading(true);
    try {
      const intakeId = await ensureIntakeTaskSessionId();
      const response = await client.chat(
        [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: message }] }],
        {
          sessionId: intakeId,
          workspace: ctx.workspace(),
          runtimeMode: "intake",
        }
      );
      if (!response.ok) {
        throw new Error(`Research request failed: ${response.status}`);
      }
      const assistantText = await readAssistantTextFromResponse(response);
      setResearchSummary(assistantText || "Research complete. Choose a spec path to continue.");
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Failed to run research");
    } finally {
      setResearchLoading(false);
    }
  };

  const handleResearchAction = async (action: string) => {
    if (action !== "wizard:start:comprehensive" && action !== "wizard:start:quick") {
      setResearchError("Unknown research action. Please choose a valid option.");
      return;
    }

    const specType = action === "wizard:start:comprehensive" ? "comprehensive" : "quick";
    const client = chatClient();
    if (!client) return;

    setResearchError(null);
    setIsApplyingResearchAction(true);
    try {
      const intakeId = await ensureIntakeTaskSessionId();
      const handoffPrompt = [
        "Produce a strict JSON handoff for task session bootstrap.",
        `Spec type: ${specType}`,
        `Research summary: ${researchSummary()}`,
        'Return JSON with keys: title, specType, initialSummary, handoffContext.',
      ].join("\n");

      const handoffResponse = await client.chat(
        [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: handoffPrompt }] }],
        {
          sessionId: intakeId,
          workspace: ctx.workspace(),
          runtimeMode: "intake",
        }
      );
      if (!handoffResponse.ok) {
        throw new Error(`Failed to generate handoff: ${handoffResponse.status}`);
      }
      const handoffText = await readAssistantTextFromResponse(handoffResponse);
      const handoffJson = extractJsonObject(handoffText);
      const handoff = validateHandoff(handoffJson);
      if (!handoff) {
        setResearchError("Handoff response was invalid. Please retry.");
        return;
      }
      const createdTask = await client.createTaskSession({
        resourceId: ctx.workspace() || ctx.projectId(),
        workspaceId: ctx.projectId(),
        sessionKind: "task",
      });
      await client.updateTaskSession(createdTask.taskSessionId, {
        status: "specifying",
        specType,
        title: handoff.title,
      });

      try {
        await transitionSessionMode({
          sessionId: createdTask.taskSessionId,
          from: "intake",
          to: "plan",
          reason: "Homepage spec selection",
        });
      } catch (error) {
        console.warn("Failed to transition runtime mode to plan:", error);
      }

      initializeWizardWorkflowFromHomepage(createdTask.taskSessionId, specType);

      await client.createProjectKeypoint({
        workspaceId: ctx.projectId(),
        taskSessionId: createdTask.taskSessionId,
        taskTitle: handoff.title,
        milestone: "started",
        summary: `Started task "${handoff.title}" with ${specType} spec after research: ${handoff.initialSummary}`,
        artifacts: [],
      });

      setResearchSummary("");
      setIntakeTaskSessionId(null);
      await ctx.refreshTaskSessions();
      await loadKeypoints();
      ctx.setActiveTaskSessionId(createdTask.taskSessionId);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "Failed to apply research action");
    } finally {
      setIsApplyingResearchAction(false);
    }
  };

  const emittedMilestones = new Set<string>();
  createEffect(() => {
    const client = chatClient();
    if (!client) return;

    for (const task of ctx.taskSessions()) {
      const startedKey = `${task.taskSessionId}:started`;
      const completedKey = `${task.taskSessionId}:completed`;

      if (task.taskStatus === "implementing" && !emittedMilestones.has(startedKey)) {
        emittedMilestones.add(startedKey);
        void client
          .createProjectKeypoint({
            workspaceId: ctx.projectId(),
            taskSessionId: task.taskSessionId,
            taskTitle: task.title ?? "Untitled task",
            milestone: "started",
            summary: `Started task "${task.title ?? "Untitled task"}" with ${
              task.specType ?? "comprehensive"
            } spec after research: Execution moved to implementation.`,
            artifacts: [],
          })
          .then(() => loadKeypoints())
          .catch(error => {
            console.error("Failed to create started keypoint:", error);
            emittedMilestones.delete(startedKey);
          });
      }

      if (
        (task.taskStatus === "completed" || task.taskStatus === "failed") &&
        !emittedMilestones.has(completedKey)
      ) {
        emittedMilestones.add(completedKey);
        void client
          .createProjectKeypoint({
            workspaceId: ctx.projectId(),
            taskSessionId: task.taskSessionId,
            taskTitle: task.title ?? "Untitled task",
            milestone: "completed",
            summary: `Completed task "${task.title ?? "Untitled task"}": ${
              task.taskStatus === "completed" ? "Delivered successfully." : "Ended with failure."
            }`,
            artifacts: [],
          })
          .then(() => loadKeypoints())
          .catch(error => {
            console.error("Failed to create completed keypoint:", error);
            emittedMilestones.delete(completedKey);
          });
      }
    }
  });

  return (
    <Show
      when={canRenderWorkspace()}
      fallback={
        <div class="bg-background text-muted-foreground flex h-screen items-center justify-center">
          Loading workspace...
        </div>
      }
    >
      <Show
        when={!isHomepageMode()}
        fallback={
          <HomepageView
            tasks={homepageTasks()}
            activeTaskSessionId={ctx.activeTaskSessionId()}
            keypoints={keypoints()}
            researchSummary={researchSummary()}
            researchLoading={researchLoading()}
            researchError={researchError()}
            isApplyingResearchAction={isApplyingResearchAction()}
            onTaskSelect={id => ctx.setActiveTaskSessionId(id)}
            onSubmitResearch={message => {
              void handleSubmitResearch(message);
            }}
            onResearchAction={action => {
              void handleResearchAction(action);
            }}
          />
        }
      >
        <WorkspaceChatProvider
          client={chatClient()!}
          workspace={ctx.workspace}
          sessionId={ctx.activeTaskSessionId}
          runtimeMode={activeTaskRuntimeMode}
          onSessionIdReceived={id => {
            if (id !== ctx.activeTaskSessionId()) {
              ctx.setActiveTaskSessionId(id);
              void ctx.refreshTaskSessions();
            }
          }}
        >
          <div class="bg-background flex h-screen flex-col overflow-hidden">
            <div class="px-3 pt-3">
              <TopToolbar
                view="task-session"
                title={currentTaskTitle()}
                onGoHome={() => ctx.setActiveTaskSessionId(null)}
              />
            </div>
            <div class="min-h-0 flex-1">
              <WorkspaceLayout />
            </div>
          </div>
        </WorkspaceChatProvider>
      </Show>
    </Show>
  );
}

export { WorkspaceViewInner };
