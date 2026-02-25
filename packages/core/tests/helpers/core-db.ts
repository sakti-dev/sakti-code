import { registerCoreDbBindings } from "@sakti-code/shared/core-server-bridge";
import * as dbModule from "../../../server/db/index.ts";

function ensureBridgeBindings(): void {
  registerCoreDbBindings({
    getDb: dbModule.getDb,
    closeDb: dbModule.closeDb,
    sessions: dbModule.taskSessions,
    tasks: dbModule.tasks,
    taskDependencies: dbModule.taskDependencies,
    taskMessages: dbModule.taskMessages,
    threads: dbModule.threads,
    messages: dbModule.messages,
    workingMemory: dbModule.workingMemory,
    reflections: dbModule.reflections,
    observationalMemory: dbModule.observationalMemory,
    toolSessions: dbModule.toolSessions,
  });
}

export async function getDb() {
  ensureBridgeBindings();
  return dbModule.getDb();
}

export function closeDb(): void {
  dbModule.closeDb();
}

export const sessions = dbModule.taskSessions;
export const tasks = dbModule.tasks;
export const taskDependencies = dbModule.taskDependencies;
export const taskMessages = dbModule.taskMessages;
export const threads = dbModule.threads;
export const messages = dbModule.messages;
export const workingMemory = dbModule.workingMemory;
export const reflections = dbModule.reflections;
export const observationalMemory = dbModule.observationalMemory;
export const toolSessions = dbModule.toolSessions;

export type {
  Message,
  NewTask,
  NewWorkingMemory,
  ObservationalMemory,
  Reflection,
  Task,
  TaskDependency,
  WorkingMemory,
} from "../../src/server-bridge";
