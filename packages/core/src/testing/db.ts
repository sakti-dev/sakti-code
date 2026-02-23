/**
 * Core Test DB Bridge
 *
 * Core-owned adapter for DB test helpers.
 * Uses shared core-server-bridge bindings registered at startup (vitest.setup.ts).
 */

import { getCoreDbBindings } from "@sakti-code/shared/core-server-bridge";

const coreDbBindings = await (async () => {
  try {
    return getCoreDbBindings();
  } catch (error) {
    try {
      await import("../../tests/vitest.setup.ts");
      return getCoreDbBindings();
    } catch {
      throw error;
    }
  }
})();

export async function getDb() {
  return coreDbBindings.getDb();
}

export function closeDb(): void {
  coreDbBindings.closeDb?.();
}

export const sessions = coreDbBindings.sessions;
export const tasks = coreDbBindings.tasks;
export const taskDependencies = coreDbBindings.taskDependencies;
export const taskMessages = coreDbBindings.taskMessages;
export const threads = coreDbBindings.threads;
export const messages = coreDbBindings.messages;
export const workingMemory = coreDbBindings.workingMemory;
export const reflections = coreDbBindings.reflections;
export const observationalMemory = coreDbBindings.observationalMemory;
export const toolSessions = coreDbBindings.toolSessions;

export type {
  Message,
  NewTask,
  NewWorkingMemory,
  ObservationalMemory,
  Reflection,
  Task,
  TaskDependency,
  WorkingMemory,
} from "@sakti-code/shared/core-server-bridge";
