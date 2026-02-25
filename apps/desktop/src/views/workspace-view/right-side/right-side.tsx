import { useTasks } from "@/core/chat/hooks";
import { useWorkspace } from "@/state/providers";
import { cn } from "@/utils";
import Resizable from "@corvu/resizable";
import { Component, Show, createSignal } from "solid-js";
import { DiffView } from "./diff/diff-view";
import { FileContext } from "./files/file-context";
import { TaskList } from "./tasks/task-list";
import { TerminalPanel } from "./terminal/terminal-panel";

interface ContextPanelProps {
  class?: string;
}

export const ContextPanel: Component<ContextPanelProps> = props => {
  const [activeTopTab, setActiveTopTab] = createSignal<"files" | "diff" | "tasks">("files");
  const ctx = useWorkspace();
  const { tasks } = useTasks(ctx.activeTaskSessionId);

  return (
    <Resizable.Panel
      initialSize={0.3}
      minSize={0.15}
      collapsible
      collapsedSize={0}
      class="overflow-visible"
    >
      <div class={cn("bg-card/5 animate-fade-in-right flex h-full flex-col", props.class)}>
        {/* Top section - Files or Diffs */}
        <div class="border-border/30 flex h-[60%] flex-col border-b">
          {/* Tab selector */}
          <div
            class={cn(
              "flex items-center gap-0.5 px-2 py-1",
              "bg-card/10 border-border/30 border-b"
            )}
          >
            <button
              onClick={() => setActiveTopTab("files")}
              class={cn(
                "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
                activeTopTab() === "files"
                  ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
                  : [
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-card/30 border-b-2 border-transparent",
                    ]
              )}
            >
              Files
            </button>
            <button
              onClick={() => setActiveTopTab("diff")}
              class={cn(
                "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
                activeTopTab() === "diff"
                  ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
                  : [
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-card/30 border-b-2 border-transparent",
                    ]
              )}
            >
              Diffs
            </button>
            <button
              onClick={() => setActiveTopTab("tasks")}
              class={cn(
                "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
                activeTopTab() === "tasks"
                  ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
                  : [
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-card/30 border-b-2 border-transparent",
                    ]
              )}
            >
              Tasks
            </button>
          </div>

          {/* Content */}
          <Show when={activeTopTab() === "files"}>
            <FileContext />
          </Show>

          <Show when={activeTopTab() === "diff"}>
            <DiffView />
          </Show>

          <Show when={activeTopTab() === "tasks"}>
            <TaskList tasks={tasks()} />
          </Show>
        </div>

        {/* Bottom section - Terminal */}
        <div class="h-[40%]">
          <TerminalPanel />
        </div>
      </div>
    </Resizable.Panel>
  );
};
