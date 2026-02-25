import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Task, TaskList } from "../types/task";

interface TaskUpdatedProperties {
  sessionId: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
  }>;
}

/**
 * useTasks - Hook to fetch and sync tasks for a session
 *
 * Uses SSE to listen for task.updated events from the server
 */
export function useTasks(sessionId: Accessor<string | null | undefined>) {
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const currentSessionId = () => sessionId() ?? "";
  let isListening = false;

  async function refresh(targetSessionId = currentSessionId()) {
    if (!targetSessionId) {
      setTasks([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/agent-tasks/${targetSessionId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.status}`);
      }

      const data: TaskList = await response.json();
      // Ignore stale fetches if session changed while request was in flight.
      if (targetSessionId === currentSessionId()) {
        setTasks(data.tasks);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  function handleTaskUpdated(event: CustomEvent<TaskUpdatedProperties>) {
    const { sessionId: eventSessionId, tasks: updatedTasks } = event.detail;

    if (eventSessionId === currentSessionId()) {
      setTasks(
        updatedTasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status as Task["status"],
          priority: t.priority,
        }))
      );
    }
  }

  function startListening() {
    if (typeof window === "undefined" || isListening) return;
    isListening = true;

    refresh();
    window.addEventListener("sakti-code:task.updated", handleTaskUpdated as EventListener);
  }

  function stopListening() {
    if (typeof window === "undefined" || !isListening) return;
    isListening = false;
    window.removeEventListener("sakti-code:task.updated", handleTaskUpdated as EventListener);
  }

  createEffect(
    on(currentSessionId, nextSessionId => {
      if (!nextSessionId) {
        setTasks([]);
        setError(null);
        return;
      }
      void refresh(nextSessionId);
    })
  );

  onCleanup(() => {
    stopListening();
  });

  return {
    tasks,
    isLoading,
    error,
    refresh,
    startListening,
    stopListening,
  };
}
