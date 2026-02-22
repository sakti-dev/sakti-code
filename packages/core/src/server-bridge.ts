import {
  getCoreBusBindings,
  getCoreDbBindings,
  type CoreDbBindings,
  type Message,
  type NewTask,
  type NewWorkingMemory,
  type ObservationalMemory,
  type Reflection,
  type Task,
  type TaskDependency,
  type WorkingMemory,
} from "@sakti-code/shared/core-server-bridge";

type TableBindingKey = Exclude<keyof CoreDbBindings, "getDb" | "closeDb">;

function tableProxy(name: TableBindingKey) {
  const target = {};
  return new Proxy(
    target,
    {
      get(_target, prop) {
        const value = (getCoreDbBindings() as unknown as Record<string, unknown>)[name as string];
        return Reflect.get(value as object, prop, value as object);
      },
      has(_target, prop) {
        const value = (getCoreDbBindings() as unknown as Record<string, unknown>)[name as string];
        return Reflect.has(value as object, prop);
      },
      ownKeys() {
        const value = (getCoreDbBindings() as unknown as Record<string, unknown>)[name as string];
        return Reflect.ownKeys(value as object);
      },
      getOwnPropertyDescriptor(_target, prop) {
        const value = (getCoreDbBindings() as unknown as Record<string, unknown>)[name as string];
        const descriptor = Object.getOwnPropertyDescriptor(value as object, prop);
        if (!descriptor) return descriptor;
        return { ...descriptor, configurable: true };
      },
      getPrototypeOf() {
        const value = (getCoreDbBindings() as unknown as Record<string, unknown>)[name as string];
        return Object.getPrototypeOf(value as object);
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

export async function getDb() {
  return getCoreDbBindings().getDb();
}

export function closeDb(): void {
  try {
    getCoreDbBindings().closeDb?.();
  } catch {
    // Tests can reset modules and unregister bindings between runs.
  }
}

export const sessions = tableProxy("sessions");
export const tasks = tableProxy("tasks");
export const taskDependencies = tableProxy("taskDependencies");
export const taskMessages = tableProxy("taskMessages");
export const threads = tableProxy("threads");
export const messages = tableProxy("messages");
export const workingMemory = tableProxy("workingMemory");
export const reflections = tableProxy("reflections");
export const observationalMemory = tableProxy("observationalMemory");
export const toolSessions = tableProxy("toolSessions");

export async function publishTaskUpdated(sessionId: string, list: Array<Task>) {
  const bus = getCoreBusBindings();
  if (!bus) return;
  await bus.publishTaskUpdated(
    sessionId,
    list.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }))
  );
}

export type {
  Message,
  NewTask,
  NewWorkingMemory,
  ObservationalMemory,
  Reflection,
  Task,
  TaskDependency,
  WorkingMemory,
};
