import { TaskCard, type TaskCardData } from "@/components/task-card/task-card";
import { cn } from "@/utils";
import { For, Show, createMemo, createSignal, type Component } from "solid-js";

export interface TaskListProps {
  tasks: TaskCardData[];
  activeTaskSessionId?: string | null;
  onTaskSelect?: (taskSessionId: string) => void;
  class?: string;
}

export const TaskList: Component<TaskListProps> = props => {
  const [query, setQuery] = createSignal("");

  const filteredTasks = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.tasks;

    return props.tasks.filter(task => {
      return (
        task.title.toLowerCase().includes(q) ||
        task.status.toLowerCase().includes(q) ||
        (task.specType ?? "").toLowerCase().includes(q)
      );
    });
  });

  return (
    <section class={cn("flex min-h-0 flex-col", props.class)}>
      <input
        type="text"
        value={query()}
        onInput={event => setQuery(event.currentTarget.value)}
        placeholder="Search tasks"
        class="mb-3 w-full rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-sm outline-none"
        aria-label="Search tasks"
      />

      <Show when={filteredTasks().length > 0} fallback={<EmptyState />}>
        <div class="scrollbar-default flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <For each={filteredTasks()}>
            {task => (
              <TaskCard
                task={task}
                active={props.activeTaskSessionId === task.taskSessionId}
                onSelect={props.onTaskSelect}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

const EmptyState: Component = () => (
  <div class="text-muted-foreground rounded-lg border border-dashed border-border/40 px-4 py-8 text-center text-sm">
    No task sessions found
  </div>
);

export default TaskList;
